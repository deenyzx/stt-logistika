// Small helpers shared by the rules modules (domain, prijenosnice, upiti).
export const who = (u) => (u ? { id: u.id, name: u.name, role: u.role } : { id: 'system', name: 'Sistem', role: null });
export const newId = (p) => p + '_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
export const pad = (n) => String(n).padStart(4, '0');
export const log = (obj, user, text) => { obj.history = [...(obj.history || []), { at: Date.now(), by: user?.name || 'Sistem', text }].slice(-100); };
// Everyone involved in something: who made it, who it is assigned to, who follows it, who commented.
export const participants = (obj) => [obj.createdBy?.id, obj.assignee, ...(obj.watchers || []), ...(obj.comments || []).map((c) => c.by?.id)].filter((x) => x && x !== 'system' && x !== 'agent');
