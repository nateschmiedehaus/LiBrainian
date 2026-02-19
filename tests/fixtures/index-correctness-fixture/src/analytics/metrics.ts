export function calculateRetention(activeUsers: number, cohortUsers: number): number {
  if (cohortUsers <= 0) {
    return 0;
  }
  return activeUsers / cohortUsers;
}

export function calculateChurn(churnedUsers: number, totalUsers: number): number {
  if (totalUsers <= 0) {
    return 0;
  }
  return churnedUsers / totalUsers;
}

export function summarizeEngagement(
  activeUsers: number,
  cohortUsers: number,
  churnedUsers: number,
  totalUsers: number,
): string {
  const retention = calculateRetention(activeUsers, cohortUsers);
  const churn = calculateChurn(churnedUsers, totalUsers);
  return `Retention: ${(retention * 100).toFixed(1)}%, Churn: ${(churn * 100).toFixed(1)}%`;
}

export function renderChartData(values: number[]): string {
  const safeValues = values.map((value) => Number.isFinite(value) ? value.toFixed(2) : '0.00');
  return `[${safeValues.join(',')}]`;
}
