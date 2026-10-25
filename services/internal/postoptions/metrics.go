package postoptions

import "errors"

// ErrMetricsUnavailable distinguishes unsupported or absent metrics from zero.
var ErrMetricsUnavailable = errors.New("provider analytics unavailable")
