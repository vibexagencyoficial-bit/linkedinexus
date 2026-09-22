package telemetry

import (
	"sync/atomic"
)

type Metrics struct {
	ActiveCampaigns atomic.Int64
	JobsProcessed   atomic.Int64
	JobsSucceeded   atomic.Int64
	JobsFailed      atomic.Int64
	RepliesDetected atomic.Int64
}

var GlobalMetrics = &Metrics{}

func IncJobsProcessed() {
	GlobalMetrics.JobsProcessed.Add(1)
}

func IncJobsSucceeded() {
	GlobalMetrics.JobsSucceeded.Add(1)
}

func IncJobsFailed() {
	GlobalMetrics.JobsFailed.Add(1)
}

func IncRepliesDetected() {
	GlobalMetrics.RepliesDetected.Add(1)
}
