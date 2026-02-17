# Claude Code Session Crash Diagnosis Report

**Generated:** 2026-01-28 19:10
**System:** macOS Darwin 24.6.0, 8-core CPU, 16GB RAM

---

## Executive Summary

The system crashes are caused by **extreme system overload** from accumulated Claude Code session data, particularly from the `wave0-autopilot` project which has created **82,285 session directories** containing 2.1GB of data. The filesystem overhead from this many directory entries is crushing system performance.

---

## Critical Findings

### 1. SEVERE: System Overload Detected

| Metric | Current Value | Normal Range | Severity |
|--------|---------------|--------------|----------|
| Load Average (1m) | 48-160 | < 8 | CRITICAL |
| Load Average (5m) | 100-132 | < 8 | CRITICAL |
| Available Memory | 146MB | > 2GB | WARNING |
| Pages in Compressor | 148,654 | < 50,000 | WARNING |

The load average should be roughly equal to or less than the CPU count (8). Values of 48-160 indicate the system is 6-20x overloaded.

### 2. ROOT CAUSE: Excessive Claude Session Data

```
/Volumes/BigSSD4/nathanielschmiedehaus/.claude/
  Total size: 5.0 GB
  Total JSONL files: 86,057

Breakdown by project:
  wave0-autopilot:    82,285 session directories (2.1 GB) <-- PRIMARY CULPRIT
  LiBrainian:          ~20 sessions (reasonable)
  Other projects:     ~3,700 sessions
```

The `wave0-autopilot` project has accumulated **82,285 directories** in a single parent directory. This exceeds the typical filesystem optimization threshold (around 10,000 entries) and causes:
- Slow directory enumeration
- High I/O wait times
- Memory pressure from inode caching
- Spotlight/mdworker going haywire trying to index

### 3. System Processes Fighting for Resources

During diagnosis, the following system processes were consuming excessive CPU:

| Process | CPU% | Cause |
|---------|------|-------|
| assistant_service | 91.8% | AI/ML background processing |
| spindump | 65.8% | System hang diagnostics (the system knows it's struggling!) |
| contactsd | 62.2% | Contact sync (triggered by system stress) |
| ANECompilerService | 49.5% | Neural engine compiling |
| mdsync/mdworker | 43.1% | Spotlight indexing |

Spotlight is likely trying to index the 86,000+ JSONL files, exacerbating the problem.

### 4. Disk Space Pressure

| Filesystem | Used | Available | Notes |
|------------|------|-----------|-------|
| Main SSD | 52% | 15GB | Low but not critical |
| Data Volume | 93% | 15GB | Getting tight |
| BigSSD4 | 73% | 521GB | Healthy |

---

## Root Cause Analysis

### Primary Cause
**Accumulated Claude Code session data** from extended multi-agent work has created tens of thousands of small files. Each Claude Code session creates:
- A session directory
- Multiple JSONL files for conversation history
- Subagent directories for orchestrated work

Over time, this accumulates into a filesystem bottleneck.

### Contributing Factors

1. **No automatic session cleanup**: Old sessions are never pruned
2. **Spotlight indexing**: macOS tries to index all JSONL files
3. **Recent boot** (24 minutes uptime): System services competing for resources during startup
4. **Memory pressure**: 15GB used, only 146MB free, forcing swap/compression

---

## Recommendations

### Immediate Actions (Do These Now)

#### 1. Exclude Claude Data from Spotlight

```bash
# Add Claude directory to Spotlight exclusions
sudo mdutil -i off /Volumes/BigSSD4/nathanielschmiedehaus/.claude/

# Alternatively, add via System Preferences > Siri & Spotlight > Privacy
```

#### 2. Clean Up Old Sessions

```bash
# CAUTION: Review before deleting!
# Remove wave0-autopilot sessions older than 7 days
find "/Volumes/BigSSD4/nathanielschmiedehaus/.claude/projects/-Volumes-BigSSD4-nathanielschmiedehaus-Documents-wave0-autopilot/" \
  -maxdepth 1 -type d -mtime +7 -exec rm -rf {} \;

# Or archive them first
tar -czf ~/wave0-sessions-archive.tar.gz \
  "/Volumes/BigSSD4/nathanielschmiedehaus/.claude/projects/-Volumes-BigSSD4-nathanielschmiedehaus-Documents-wave0-autopilot/"
rm -rf "/Volumes/BigSSD4/nathanielschmiedehaus/.claude/projects/-Volumes-BigSSD4-nathanielschmiedehaus-Documents-wave0-autopilot/"
```

#### 3. Prevent Runaway System Processes

```bash
# Temporarily disable Spotlight on the external drive
sudo mdutil -i off /Volumes/BigSSD4

# Re-enable after cleanup if needed
sudo mdutil -i on /Volumes/BigSSD4
```

### Medium-Term Safeguards

#### 4. Add Session Cleanup to Workflow

Create a cleanup script at `~/.local/bin/claude-cleanup.sh`:

```bash
#!/bin/bash
# Claude Code session cleanup script
CLAUDE_DIR="$HOME/.claude/projects"
MAX_AGE_DAYS=14
MAX_SESSIONS_PER_PROJECT=100

echo "Cleaning Claude sessions older than $MAX_AGE_DAYS days..."

for project_dir in "$CLAUDE_DIR"/*/; do
  session_count=$(ls -1 "$project_dir" 2>/dev/null | wc -l)
  if [ "$session_count" -gt "$MAX_SESSIONS_PER_PROJECT" ]; then
    echo "Project $(basename "$project_dir") has $session_count sessions"
    # Delete oldest sessions beyond limit
    ls -1t "$project_dir" | tail -n +$((MAX_SESSIONS_PER_PROJECT + 1)) | \
      xargs -I{} rm -rf "$project_dir/{}"
  fi
done

echo "Cleanup complete."
```

#### 5. Monitor System Resources

Add to your shell profile:

```bash
# Warn if load is too high before starting Claude
alias claude-check='load=$(sysctl -n vm.loadavg | awk "{print \$2}"); \
  if (( $(echo "$load > 10" | bc -l) )); then \
    echo "WARNING: System load is $load. Consider waiting."; \
  fi'
```

### Long-Term Fixes

#### 6. Request Claude Code Feature: Session Pruning

Claude Code should implement:
- Automatic pruning of sessions older than N days
- Maximum session count per project
- Session archival instead of deletion
- `.claudeignore` support for Spotlight exclusion

#### 7. LiBrainian Project: Add Resource Guards

The LiBrainian's `SwarmRunner` should have:
- Maximum concurrent workers based on system load
- Adaptive throttling when load exceeds CPU count
- Memory pressure detection and backoff

---

## LiBrainian-Specific Analysis

The LiBrainian codebase itself does **not** appear to have resource leaks:

1. **SwarmRunner**: Uses configurable `maxWorkers` (line 99-100, 144)
2. **While loops**: All `while(true)` loops have proper break conditions
3. **Spawn/exec**: Uses `spawnSync` for git operations (synchronous, not accumulating)
4. **Memory cleanup**: SwarmRunner has explicit cleanup every 50 files (line 255)

However, the test suite is extensive (100+ test files) and running `npm test` during high load could contribute to crashes.

---

## Verification Steps

After applying fixes, verify:

```bash
# Check load average (should be < 8)
uptime

# Check Claude directory size
du -sh ~/.claude/

# Count session directories
find ~/.claude/projects -maxdepth 2 -type d | wc -l

# Verify Spotlight exclusion
mdutil -s /Volumes/BigSSD4
```

---

## Summary

| Issue | Fix | Priority |
|-------|-----|----------|
| 82,285 session dirs | Delete/archive old sessions | IMMEDIATE |
| Spotlight indexing | Exclude .claude from Spotlight | IMMEDIATE |
| System overload | Wait for load to drop, then work | IMMEDIATE |
| No auto-cleanup | Create cleanup script | MEDIUM |
| Resource monitoring | Add load check alias | MEDIUM |

The crashes are **not** caused by bugs in the LiBrainian code but by accumulated Claude Code session data overwhelming filesystem operations.
