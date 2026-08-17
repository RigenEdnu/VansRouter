// AWS region allowlist. Keep URL interpolation behind this boundary.
// Kiro's q/codewhisperer endpoints use the commercial AWS DNS partition.
// Keep GovCloud/China/ISO out until their Kiro endpoint contracts are known.
export const AWS_REGION_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*-\d{1,2}$/;
const UNSUPPORTED_KIRO_PARTITION = /^(?:cn|us-gov|us-iso|us-isob)-/;

export function assertValidAwsRegion(region) {
  if (typeof region !== "string" || !AWS_REGION_PATTERN.test(region)) {
    throw new Error("Invalid region");
  }
  return region;
}

export function assertValidKiroRegion(region) {
  assertValidAwsRegion(region);
  if (UNSUPPORTED_KIRO_PARTITION.test(region)) {
    throw new Error(`Unsupported Kiro region: ${region}`);
  }
  return region;
}
