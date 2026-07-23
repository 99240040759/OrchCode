use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::Engine;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use tauri::ipc::Channel;

use crate::error::{AppError, AppResult};
use crate::events::DictationEvent;
use crate::gateway::Gateway;

const POLL_MS: u64 = 200;
const MAX_SECONDS: u32 = 120;

type Samples = Arc<Mutex<Vec<i16>>>;

pub struct DictationHandle {
    recording: Arc<AtomicBool>,
}

impl DictationHandle {
    pub fn stop(&self) {
        self.recording.store(false, Ordering::SeqCst);
    }
}

pub fn start(gateway: Arc<Gateway>, channel: Channel<DictationEvent>) -> AppResult<DictationHandle> {
    let recording = Arc::new(AtomicBool::new(true));
    let samples: Samples = Arc::new(Mutex::new(Vec::new()));
    let sample_rate = Arc::new(std::sync::atomic::AtomicU32::new(0));

    let (tx, rx) = crossbeam_channel::unbounded::<i16>();

    {
        let recording = recording.clone();
        let samples = samples.clone();
        let sample_rate = sample_rate.clone();
        std::thread::spawn(move || {
            while recording.load(Ordering::SeqCst) {
                if let Ok(sample) = rx.recv_timeout(Duration::from_millis(500)) {
                    let sr = sample_rate.load(Ordering::SeqCst);
                    let max_samples = if sr > 0 { (sr * MAX_SECONDS) as usize } else { 44100 * MAX_SECONDS as usize };
                    if let Ok(mut b) = samples.lock() {
                        if b.len() >= max_samples {
                            recording.store(false, Ordering::SeqCst);
                        } else {
                            b.push(sample);
                        }
                    }
                }
            }
        });
    }

    {
        let recording = recording.clone();
        let sample_rate = sample_rate.clone();
        let channel = channel.clone();
        std::thread::spawn(move || {
            if let Err(e) = capture_loop(&recording, tx, &sample_rate) {
                recording.store(false, Ordering::SeqCst);
                let _ = channel.send(DictationEvent::Error { message: e.to_string() });
            }
        });
    }

    {
        let recording = recording.clone();
        let samples = samples.clone();
        let sample_rate = sample_rate.clone();
        tauri::async_runtime::spawn(async move {
            transcribe_loop(gateway, channel, recording, samples, sample_rate).await;
        });
    }

    Ok(DictationHandle { recording })
}

fn capture_loop(
    recording: &Arc<AtomicBool>,
    tx: crossbeam_channel::Sender<i16>,
    sample_rate: &Arc<std::sync::atomic::AtomicU32>,
) -> AppResult<()> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| AppError::Audio("no input device found".to_string()))?;
    let supported = device
        .default_input_config()
        .map_err(|e| AppError::Audio(format!("no default input config: {e}")))?;

    let sr = supported.sample_rate().0;
    let channels = supported.channels() as usize;
    sample_rate.store(sr, Ordering::SeqCst);

    let config: cpal::StreamConfig = supported.config();
    let err_fn = |err| eprintln!("dictation input error: {err}");

    macro_rules! make_stream {
        ($t:ty, $to_i16:expr) => {{
            let rec = recording.clone();
            let sender = tx.clone();
            device.build_input_stream(
                &config,
                move |data: &[$t], _: &cpal::InputCallbackInfo| {
                    if !rec.load(Ordering::SeqCst) { return; }
                    for frame in data.chunks(channels.max(1)) {
                        let mut acc: i32 = 0;
                        for &s in frame { acc += ($to_i16)(s) as i32; }
                        let mono = (acc / frame.len().max(1) as i32) as i16;
                        let _ = sender.send(mono);
                    }
                },
                err_fn,
                None,
            )
        }};
    }

    let stream = match supported.sample_format() {
        cpal::SampleFormat::F32 => make_stream!(f32, |s: f32| (s.clamp(-1.0, 1.0) * 32767.0) as i16),
        cpal::SampleFormat::I16 => make_stream!(i16, |s: i16| s),
        cpal::SampleFormat::U16 => make_stream!(u16, |s: u16| (s as i32 - 32768) as i16),
        other => return Err(AppError::Audio(format!("unsupported sample format: {other:?}"))),
    }
    .map_err(|e| AppError::Audio(format!("failed to build input stream: {e}")))?;

    stream.play().map_err(|e| AppError::Audio(format!("failed to start stream: {e}")))?;

    while recording.load(Ordering::SeqCst) {
        std::thread::sleep(Duration::from_millis(POLL_MS));
    }
    drop(stream);
    Ok(())
}

async fn transcribe_loop(
    gateway: Arc<Gateway>,
    channel: Channel<DictationEvent>,
    recording: Arc<AtomicBool>,
    samples: Samples,
    sample_rate: Arc<std::sync::atomic::AtomicU32>,
) {
    loop {
        tokio::time::sleep(Duration::from_millis(POLL_MS)).await;

        if !recording.load(Ordering::SeqCst) {
            let sr = sample_rate.load(Ordering::SeqCst);
            let snapshot: Vec<i16> = samples.lock().map(|b| b.clone()).unwrap_or_default();

            if sr == 0 || snapshot.is_empty() {
                let _ = channel.send(DictationEvent::Final { text: String::new() });
            } else {
                match transcribe(&gateway, &snapshot, sr).await {
                    Ok(text) => { let _ = channel.send(DictationEvent::Final { text }); }
                    Err(e) => { let _ = channel.send(DictationEvent::Error { message: e.to_string() }); }
                }
            }
            return;
        }
    }
}

async fn transcribe(gateway: &Gateway, samples: &[i16], sample_rate: u32) -> AppResult<String> {
    let wav = encode_wav(samples, sample_rate)?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&wav);
    gateway.transcribe(&b64).await
}

fn encode_wav(samples: &[i16], sample_rate: u32) -> AppResult<Vec<u8>> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut cursor = std::io::Cursor::new(Vec::<u8>::new());
    {
        let mut writer = hound::WavWriter::new(&mut cursor, spec)
            .map_err(|e| AppError::Audio(format!("wav init failed: {e}")))?;
        for &s in samples {
            writer.write_sample(s).map_err(|e| AppError::Audio(format!("wav write failed: {e}")))?;
        }
        writer.finalize().map_err(|e| AppError::Audio(format!("wav finalize failed: {e}")))?;
    }
    Ok(cursor.into_inner())
}
