import type { LeadSecao } from '../tipos';

export default function LeadSection({ body }: LeadSecao) {
  if (!body) return null;
  return <p className="wd-lead">{body}</p>;
}
