#!/bin/bash
# Test only: stops the latency harness that run.sh started, by the process id the harness wrote to ./pid.
cd "$(dirname "$0")" && [ -f pid ] && kill "$(cat pid)" 2>/dev/null; rm -f pid; echo stopped
