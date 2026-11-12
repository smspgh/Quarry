//! Writing to a child process (Claude Code, a language server, a terminal) without blocking the
//! caller. Synchronous Tauri commands run on the main thread, and a blocking `write_all` to a child
//! that has stopped reading (or a large message to one that reads slowly) froze the whole window.
//! Each child gets a writer thread fed by a channel; sends are queued in order, so messages still
//! arrive in the order the commands ran.

use std::io::Write;
use std::sync::mpsc::{channel, Sender};

pub struct ChannelWriter(Sender<Vec<u8>>);

impl ChannelWriter {
    /// Start a thread that owns `w` and writes whatever is sent, until a write fails or the
    /// `ChannelWriter` is dropped (which also drops `w`, closing the child's stdin).
    pub fn spawn<W: Write + Send + 'static>(mut w: W, name: &str) -> Self {
        let (tx, rx) = channel::<Vec<u8>>();
        let _ = std::thread::Builder::new().name(name.to_string()).spawn(move || {
            for buf in rx {
                if w.write_all(&buf).and_then(|_| w.flush()).is_err() {
                    break;
                }
            }
        });
        Self(tx)
    }

    /// Queue `bytes`; an error means the writer has stopped (the child closed its input or exited).
    pub fn send(&self, bytes: Vec<u8>) -> Result<(), ()> {
        self.0.send(bytes).map_err(|_| ())
    }
}

/// Run `f` for every item on its own thread and wait for all of them (stopping several processes
/// at once when the window closes, instead of one `taskkill` after another).
pub fn run_all<T: Send + 'static>(items: Vec<T>, f: fn(T)) {
    let handles: Vec<_> = items.into_iter().map(|t| std::thread::spawn(move || f(t))).collect();
    for h in handles {
        let _ = h.join();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    struct Shared(Arc<Mutex<Vec<u8>>>);
    impl Write for Shared {
        fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(b);
            Ok(b.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn writes_in_order_and_reports_a_stopped_writer() {
        let out = Arc::new(Mutex::new(Vec::new()));
        let w = ChannelWriter::spawn(Shared(out.clone()), "test-writer");
        for i in 0..100u8 {
            w.send(vec![i]).unwrap();
        }
        drop(w);
        std::thread::sleep(std::time::Duration::from_millis(100));
        assert_eq!(*out.lock().unwrap(), (0..100u8).collect::<Vec<_>>());

        struct Broken;
        impl Write for Broken {
            fn write(&mut self, _: &[u8]) -> std::io::Result<usize> {
                Err(std::io::ErrorKind::BrokenPipe.into())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let b = ChannelWriter::spawn(Broken, "broken-writer");
        let _ = b.send(vec![1]);
        std::thread::sleep(std::time::Duration::from_millis(100));
        assert!(b.send(vec![2]).is_err());
    }
}
