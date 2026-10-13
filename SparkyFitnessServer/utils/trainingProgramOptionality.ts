export function isOptionalProgramSessionOmitted(
  session: {
    is_optional: boolean;
    status: string;
    effective_date: string;
  },
  today: string
): boolean {
  return (
    session.is_optional &&
    session.status === 'planned' &&
    session.effective_date < today
  );
}
