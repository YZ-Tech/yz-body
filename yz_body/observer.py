"""Body events — thin shim over the shared EventBroadcaster.

The broadcaster body lives in yz-satellite-common (it existed here as one
of four byte-identical observer.py copies); this module keeps the original
import surface (`from .observer import emit` etc.) and the channel name."""
from __future__ import annotations

from yz_satellite_common import EventBroadcaster

broadcaster = EventBroadcaster("body")

subscribe = broadcaster.subscribe
unsubscribe = broadcaster.unsubscribe
emit = broadcaster.emit
num_subscribers = broadcaster.num_subscribers
