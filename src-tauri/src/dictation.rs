use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::Engine;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use ringbuf::traits::{Consumer, Observer, Producer, Split};
use ringbuf::HeapRb;
use rubato::{Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction};
use tauri::ipc::Channel;

use crate::error::{AppError, AppResult};
use crate::events::DictationEvent;
use crate::gateway::Gateway;

const MAX_SECONDS: u32 = 300;

type Samples = Arc<Mutex<Vec<i16>>>;

pub struct DictationHandle {
    recording: Arc<AtomicBool>,
    finished: Arc<AtomicBool>,
    stop_notify: Arc<tokio::sync::Notify>,
}

impl DictationHandle {
    pub fn stop(&self) {
        self.recording.store(false, Ordering::SeqCst);
        self.stop_notify.notify_waiters();
    }

    pub fn cancel(&self) {
        self.finished.store(true, Ordering::SeqCst);
        self.recording.store(false, Ordering::SeqCst);
        self.stop_notify.notify_waiters();
    }
}

pub fn start(gateway: Arc<Gateway>, channel: Channel<DictationEvent>) -> AppResult<DictationHandle> {
    let recording = Arc::new(AtomicBool::new(true));
    let finished = Arc::new(AtomicBool::new(false));
    let capture_finished = Arc::new(AtomicBool::new(false));
    let stop_notify = Arc::new(tokio::sync::Notify::new());
    let capture_notify = Arc::new(tokio::sync::Notify::new());
    let samples: Samples = Arc::new(Mutex::new(Vec::with_capacity(65536)));
    let sample_rate = Arc::new(AtomicU32::new(0));

    {
        let recording = recording.clone();
        let samples = samples.clone();
        let sample_rate = sample_rate.clone();
        let channel = channel.clone();
        let finished = finished.clone();
        let capture_finished = capture_finished.clone();
        let capture_notify = capture_notify.clone();
        std::thread::spawn(move || {
            if let Err(e) = capture_loop(&recording, &samples, &sample_rate) {
                sentry::capture_error(&e);
                recording.store(false, Ordering::SeqCst);
                finished.store(true, Ordering::SeqCst);
                let _ = channel.send(DictationEvent::Error {
                    message: e.to_string(),
                });
            }
            capture_finished.store(true, Ordering::SeqCst);
            capture_notify.notify_waiters();
        });
    }

    {
        let recording = recording.clone();
        let finished = finished.clone();
        let capture_finished = capture_finished.clone();
        let stop_notify = stop_notify.clone();
        let capture_notify = capture_notify.clone();
        let samples = samples.clone();
        let sample_rate = sample_rate.clone();
        tauri::async_runtime::spawn(async move {
            transcribe_when_stopped(
                gateway,
                channel,
                recording,
                finished,
                capture_finished,
                stop_notify,
                capture_notify,
                samples,
                sample_rate,
            )
            .await;
        });
    }

    Ok(DictationHandle {
        recording,
        finished,
        stop_notify,
    })
}

fn capture_loop(
    recording: &Arc<AtomicBool>,
    samples: &Samples,
    sample_rate: &Arc<AtomicU32>,
) -> AppResult<()> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| AppError::Audio("no input device found".to_string()))?;
    let supported = device
        .default_input_config()
        .map_err(|e| AppError::Audio(format!("no default input config: {e}")))?;

    let sr = supported.sample_rate().0;
    if sr == 0 {
        return Err(AppError::Audio("input device reported a zero sample rate".to_string()));
    }
    let channels = supported.channels().max(1) as usize;
    sample_rate.store(sr, Ordering::SeqCst);
    let max_samples = (sr as usize).saturating_mul(MAX_SECONDS as usize);

    let config: cpal::StreamConfig = supported.config();
    let err_fn = |err| {
        eprintln!("[dictation] input stream error: {err}");
        sentry::capture_message(&format!("dictation input stream error: {err}"), sentry::Level::Error);
    };

    let rb = HeapRb::<i16>::new(65536);
    let (mut prod, mut cons) = rb.split();
    let samples_clone = samples.clone();
    let rec_collector = recording.clone();
    let collector_thread = std::thread::spawn(move || {
        let mut collector = Vec::with_capacity(65536);
        while rec_collector.load(Ordering::SeqCst) || !cons.is_empty() {
            let mut had_samples = false;
            while let Some(sample) = cons.try_pop() {
                had_samples = true;
                if collector.len() >= max_samples {
                    rec_collector.store(false, Ordering::SeqCst);
                    break;
                }
                collector.push(sample);
            }
            if !had_samples && rec_collector.load(Ordering::SeqCst) {
                std::thread::sleep(Duration::from_millis(5));
            }
        }
        if let Ok(mut guard) = samples_clone.lock() {
            *guard = collector;
        }
    });

    let stream = match supported.sample_format() {
        cpal::SampleFormat::F32 => {
            let rec = recording.clone();
            device.build_input_stream(
                &config,
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    if !rec.load(Ordering::SeqCst) {
                        return;
                    }
                    for frame in data.chunks(channels) {
                        let mut acc: i32 = 0;
                        for &s in frame {
                            acc += (s.clamp(-1.0, 1.0) * 32767.0) as i32;
                        }
                        let sample = (acc / channels as i32) as i16;
                        let _ = prod.try_push(sample);
                    }
                },
                err_fn,
                None,
            )
        }
        cpal::SampleFormat::I16 => {
            let rec = recording.clone();
            device.build_input_stream(
                &config,
                move |data: &[i16], _: &cpal::InputCallbackInfo| {
                    if !rec.load(Ordering::SeqCst) {
                        return;
                    }
                    for frame in data.chunks(channels) {
                        let mut acc: i32 = 0;
                        for &s in frame {
                            acc += s as i32;
                        }
                        let sample = (acc / channels as i32) as i16;
                        let _ = prod.try_push(sample);
                    }
                },
                err_fn,
                None,
            )
        }
        cpal::SampleFormat::U16 => {
            let rec = recording.clone();
            device.build_input_stream(
                &config,
                move |data: &[u16], _: &cpal::InputCallbackInfo| {
                    if !rec.load(Ordering::SeqCst) {
                        return;
                    }
                    for frame in data.chunks(channels) {
                        let mut acc: i32 = 0;
                        for &s in frame {
                            acc += s as i32 - 32768;
                        }
                        let sample = (acc / channels as i32) as i16;
                        let _ = prod.try_push(sample);
                    }
                },
                err_fn,
                None,
            )
        }
        other => {
            return Err(AppError::Audio(format!(
                "unsupported sample format: {other:?}"
            )))
        }
    }
    .map_err(|e| AppError::Audio(format!("failed to build input stream: {e}")))?;

    stream
        .play()
        .map_err(|e| AppError::Audio(format!("failed to start stream: {e}")))?;

    while recording.load(Ordering::SeqCst) {
        std::thread::sleep(Duration::from_millis(50));
    }
    drop(stream);
    let _ = collector_thread.join();
    Ok(())
}

async fn transcribe_when_stopped(
    gateway: Arc<Gateway>,
    channel: Channel<DictationEvent>,
    recording: Arc<AtomicBool>,
    finished: Arc<AtomicBool>,
    capture_finished: Arc<AtomicBool>,
    stop_notify: Arc<tokio::sync::Notify>,
    capture_notify: Arc<tokio::sync::Notify>,
    samples: Samples,
    sample_rate: Arc<AtomicU32>,
) {
    if recording.load(Ordering::SeqCst) {
        stop_notify.notified().await;
    }

    if !capture_finished.load(Ordering::SeqCst) && !finished.load(Ordering::SeqCst) {
        let _ = tokio::time::timeout(Duration::from_secs(3), capture_notify.notified()).await;
    }

    if finished.load(Ordering::SeqCst) {
        return;
    }

    let sr = sample_rate.load(Ordering::SeqCst);
    let snapshot: Vec<i16> = samples
        .lock()
        .map(|mut b| std::mem::take(&mut *b))
        .unwrap_or_default();

    let event = if sr == 0 || snapshot.is_empty() {
        DictationEvent::Final {
            text: String::new(),
        }
    } else {
        match transcribe(&gateway, &snapshot, sr).await {
            Ok(text) => DictationEvent::Final { text },
            Err(e) => {
                sentry::capture_error(&e);
                DictationEvent::Error {
                    message: e.to_string(),
                }
            }
        }
    };

    if finished.swap(true, Ordering::SeqCst) {
        return;
    }
    let _ = channel.send(event);
}

fn resample(samples: &[i16], from_rate: u32, to_rate: u32) -> Vec<i16> {
    if from_rate == to_rate || samples.is_empty() {
        return samples.to_vec();
    }

    let f32_samples: Vec<f32> = samples.iter().map(|&s| s as f32 / 32768.0).collect();
    let chunk_size = 1024;
    let params = SincInterpolationParameters {
        sinc_len: 64,
        f_cutoff: 0.95,
        interpolation: SincInterpolationType::Linear,
        oversampling_factor: 128,
        window: WindowFunction::Hann,
    };

    let mut resampler = match SincFixedIn::<f32>::new(
        to_rate as f64 / from_rate as f64,
        2.0,
        params,
        chunk_size,
        1,
    ) {
        Ok(r) => r,
        Err(_) => return samples.to_vec(),
    };

    let estimated_out = (samples.len() as f64 * to_rate as f64 / from_rate as f64) as usize;
    let mut output: Vec<i16> = Vec::with_capacity(estimated_out);
    let mut pos = 0;

    while pos < f32_samples.len() {
        let needed = resampler.input_frames_next();
        let chunk: Vec<f32> = if pos + needed <= f32_samples.len() {
            f32_samples[pos..pos + needed].to_vec()
        } else {
            let mut padded = f32_samples[pos..].to_vec();
            padded.resize(needed, 0.0);
            padded
        };
        pos += needed;

        if let Ok(resampled) = resampler.process(&[&chunk], None) {
            if let Some(ch) = resampled.first() {
                for &s in ch {
                    output.push((s.clamp(-1.0, 1.0) * 32767.0).round() as i16);
                }
            }
        }
    }

    output
}

async fn transcribe(gateway: &Gateway, samples: &[i16], sample_rate: u32) -> AppResult<String> {
    let target = crate::config::DICTATION_TARGET_SAMPLE_RATE;
    let (samples, sample_rate) = if sample_rate > target {
        (resample(samples, sample_rate, target), target)
    } else {
        (samples.to_vec(), sample_rate)
    };
    let wav = encode_wav(&samples, sample_rate)?;
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
            writer
                .write_sample(s)
                .map_err(|e| AppError::Audio(format!("wav write failed: {e}")))?;
        }
        writer
            .finalize()
            .map_err(|e| AppError::Audio(format!("wav finalize failed: {e}")))?;
    }
    Ok(cursor.into_inner())
}
