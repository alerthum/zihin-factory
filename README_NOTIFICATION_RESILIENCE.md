# Notification resilience patch

A successful AI execution is no longer marked failed only because Telegram delivery fails.

New behavior:
- AI/provider/persistence failure => job FAILED
- Telegram failure after successful AI => job COMPLETED + notification warning event
- Telegram delivery remains retried
- failure notification remains best-effort
