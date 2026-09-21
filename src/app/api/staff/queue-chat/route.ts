import { NextRequest, NextResponse } from 'next/server';
import { QueueService } from '@/lib/services/queue-service';

/**
 * GET /api/staff/queue-chat?entryId=xxx
 * Returns live chat messages for a queue entry — polled every 3s by StaffQueueChatModal.
 */
export async function GET(req: NextRequest) {
  try {
    const entryId = req.nextUrl.searchParams.get('entryId');
    if (!entryId) {
      return NextResponse.json({ error: 'entryId is required' }, { status: 400 });
    }

    const history = await QueueService.getQueueChatHistory(entryId);

    // Map to the QueueChatMessage shape expected by the UI
    const messages = history.map((ev) => ({
      id: ev.id,
      sender: ev.sender as 'customer' | 'staff',
      senderName: ev.senderName,
      message: ev.message,
      createdAt: ev.createdAt,
    }));

    return NextResponse.json(
      { messages },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache',
        },
      }
    );
  } catch (err) {
    console.error('[queue-chat API] Error:', err);
    return NextResponse.json({ error: 'Failed to fetch chat messages' }, { status: 500 });
  }
}
