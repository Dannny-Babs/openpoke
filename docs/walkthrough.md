# Two-minute walkthrough

Start the offline demo using the [README](../README.md#quick-start-offline-demo). It uses fictional history and scripted replies; no model or mailbox is connected.

1. Open [localhost:3000](http://127.0.0.1:3000) and confirm the Offline demo label. Send "Draft an email to Nora." Notice the request status and email card with its subject, recipient and Not sent label.
2. Select Sample · Reply to Nora in the sidebar. Its saved history opens without running anything. Choose Continue this task and send "Make it shorter and say Friday works." Notice the exact task target, revised draft and retained earlier reply.
3. Choose New task, then send "Slow book club plan." It runs as separate work. Open Activity to inspect its status; opening activity or saved history does not send another request.
4. Copy the draft or prepare a follow-up from a reply. Preparing a prompt stays local until Send. Review [engineering decisions](tradeoffs.md) for the directory bound and the remaining lookup and context limitations.
