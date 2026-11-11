use std::sync::Arc;
use std::time::Instant;

use serde_json::json;

use crate::events::{ChatEvent, EventSink};

pub const WORK_STEP: &str = "work";

const WORK_INDEX_BASE: i64 = 1 << 40;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WorkRun {
    pub seconds: u64,
    pub stopped: bool,
}

pub struct WorkTracker {
    sink: Arc<dyn EventSink>,
    next_index: i64,
    open: Option<(i64, Instant)>,
    runs: Vec<WorkRun>,
}

impl WorkTracker {
    pub fn new(sink: Arc<dyn EventSink>) -> Self {
        Self {
            sink,
            next_index: WORK_INDEX_BASE,
            open: None,
            runs: Vec::new(),
        }
    }

    pub fn enter(&mut self) {
        if self.open.is_some() {
            return;
        }
        let index = self.next_index;
        self.next_index += 1;
        self.sink
            .send(ChatEvent::step_start(index, json!({ "type": WORK_STEP })));
        self.open = Some((index, Instant::now()));
    }

    pub fn leave(&mut self, stopped: bool) {
        let Some((index, started)) = self.open.take() else {
            return;
        };
        let seconds = started.elapsed().as_secs_f64().round().max(1.0) as u64;
        self.runs.push(WorkRun { seconds, stopped });
        self.sink.send(ChatEvent::step_stop(
            index,
            json!({ "duration_seconds": seconds, "stopped": stopped }),
        ));
    }

    pub fn take_runs(&mut self) -> Vec<WorkRun> {
        std::mem::take(&mut self.runs)
    }
}
