export async function findFirstInvalidStep(stepKeys, validateStep, index = 0) {
  if (index >= stepKeys.length) {
    return null;
  }

  const stepKey = stepKeys[index];
  const isValid = await validateStep(stepKey);
  if (!isValid) {
    return stepKey;
  }

  return findFirstInvalidStep(stepKeys, validateStep, index + 1);
}
