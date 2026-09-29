// Comments on orders, reservations, inbox items and stock exports: { kind, id, text } / { kind, id, commentId }.
import { route, json, body } from '@/lib/http.js';
import { addComment, deleteComment } from '@/lib/domain.js';

export const POST = route(null, async (req, { user }) => {
  const b = await body(req);
  const { comment, obj } = await addComment(b.kind, b.id, b.text, user);
  return json({ comment, obj });
});

export const DELETE = route(null, async (req, { user }) => {
  const b = await body(req);
  const obj = await deleteComment(b.kind, b.id, b.commentId, user);
  return json({ obj });
});
