//! Battery / power policy and small pure helpers used by the wallpaper engine.
//!
//! Everything here is plain `std` so it can be unit-tested without Tauri.
//! macOS is read through `pmset`; other platforms report "plugged in".

use std::process::Command;

/// Snapshot of the machine's power state.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PowerStatus {
    pub on_battery: bool,
    pub percent: Option<u8>,
    pub low_power: bool,
}

/// User policy for when live wallpapers should stop playing.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PowerPolicy {
    /// Pause whenever the Mac is running on battery.
    pub pause_on_battery: bool,
    /// Pause on battery once the charge drops to or below this percentage.
    pub battery_threshold: u8,
    /// Pause while macOS Low Power Mode is on.
    pub pause_on_low_power: bool,
}

impl Default for PowerPolicy {
    fn default() -> Self {
        Self {
            pause_on_battery: false,
            battery_threshold: 30,
            pause_on_low_power: true,
        }
    }
}

/// Parses `pmset -g batt` output into (on_battery, percent).
pub fn parse_batt(out: &str) -> (bool, Option<u8>) {
    let on_battery = out.contains("'Battery Power'");
    let percent = out.split('%').next().and_then(|head| {
        let digits: String = head
            .chars()
            .rev()
            .take_while(|c| c.is_ascii_digit())
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        digits.parse::<u8>().ok()
    });
    // Only trust a percentage when an internal battery is listed.
    let percent = if out.contains("InternalBattery") { percent } else { None };
    (on_battery, percent)
}

/// Parses `pmset -g` output for the `lowpowermode` flag.
pub fn parse_low_power(out: &str) -> bool {
    out.lines().any(|line| {
        let mut parts = line.split_whitespace();
        parts.next() == Some("lowpowermode") && parts.next() == Some("1")
    })
}

/// Why playback should be paused under `policy`, or `None` to keep playing.
pub fn pause_reason(status: &PowerStatus, policy: &PowerPolicy) -> Option<&'static str> {
    if policy.pause_on_low_power && status.low_power {
        return Some("Low Power Mode");
    }
    if status.on_battery {
        if policy.pause_on_battery {
            return Some("On battery");
        }
        if let Some(p) = status.percent {
            if p <= policy.battery_threshold {
                return Some("Battery low");
            }
        }
    }
    None
}

/// Reads the current power state (cheap: two short `pmset` calls on macOS).
pub fn read_status() -> PowerStatus {
    if !cfg!(target_os = "macos") {
        return PowerStatus { on_battery: false, percent: None, low_power: false };
    }
    let run = |args: &[&str]| -> String {
        Command::new("pmset")
            .args(args)
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
            .unwrap_or_default()
    };
    let (on_battery, percent) = parse_batt(&run(&["-g", "batt"]));
    PowerStatus {
        on_battery,
        percent,
        low_power: parse_low_power(&run(&["-g"])),
    }
}

/// Quotes a string for use inside an AppleScript string literal.
pub fn applescript_quote(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for c in value.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' | '\r' => out.push(' '),
            _ => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Chooses the next index of a rotation of `len` items.
/// Sequential wraps around; shuffle never repeats `current` when `len > 1`.
pub fn pick_next(len: usize, current: Option<usize>, shuffle: bool, rand: u64) -> usize {
    if len == 0 {
        return 0;
    }
    if !shuffle {
        return current.map_or(0, |c| (c + 1) % len);
    }
    match current {
        Some(c) if len > 1 => {
            let step = 1 + (rand as usize) % (len - 1);
            (c + step) % len
        }
        _ => (rand as usize) % len,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const BATT: &str = "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1234)\t87%; discharging; 4:12 remaining present: true\n";
    const AC: &str = "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1234)\t100%; charged; 0:00 remaining present: true\n";
    const DESKTOP: &str = "Now drawing from 'AC Power'\n";

    #[test]
    fn parses_battery() {
        assert_eq!(parse_batt(BATT), (true, Some(87)));
        assert_eq!(parse_batt(AC), (false, Some(100)));
        assert_eq!(parse_batt(DESKTOP), (false, None));
        assert_eq!(parse_batt(""), (false, None));
    }

    #[test]
    fn parses_low_power() {
        assert!(parse_low_power("Battery Power:\n lowpowermode         1\n sleep 1\n"));
        assert!(!parse_low_power(" lowpowermode         0\n"));
        assert!(!parse_low_power(""));
    }

    #[test]
    fn policy() {
        let p = PowerPolicy::default();
        let mk = |b, pc, lp| PowerStatus { on_battery: b, percent: pc, low_power: lp };
        assert_eq!(pause_reason(&mk(false, Some(10), false), &p), None);
        assert_eq!(pause_reason(&mk(true, Some(80), false), &p), None);
        assert_eq!(pause_reason(&mk(true, Some(30), false), &p), Some("Battery low"));
        assert_eq!(pause_reason(&mk(false, None, true), &p), Some("Low Power Mode"));
        let strict = PowerPolicy { pause_on_battery: true, ..p };
        assert_eq!(pause_reason(&mk(true, Some(90), false), &strict), Some("On battery"));
        assert_eq!(pause_reason(&mk(false, Some(90), false), &strict), None);
    }

    #[test]
    fn quotes() {
        assert_eq!(applescript_quote(r#"/a/b "c"\d"#), r#""/a/b \"c\"\\d""#);
    }

    #[test]
    fn rotation() {
        assert_eq!(pick_next(3, None, false, 0), 0);
        assert_eq!(pick_next(3, Some(2), false, 0), 0);
        for r in 0..50u64 {
            for c in 0..4 {
                let n = pick_next(4, Some(c), true, r);
                assert!(n < 4 && n != c);
            }
        }
        assert_eq!(pick_next(1, Some(0), true, 7), 0);
        assert_eq!(pick_next(0, None, true, 7), 0);
    }
}
