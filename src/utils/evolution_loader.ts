/**
 * @fileoverview Evolution Module Loader
 *
 * Loads evolution modules from the local source tree during development,
 * then falls back to optional external package installs for slim npm builds.
 */

export async function loadEvolutionModule<T>(
  featureName: string,
  loadInternal: () => Promise<T>,
  loadExternal: () => Promise<T>,
): Promise<T> {
  try {
    return await loadInternal();
  } catch (internalError) {
    try {
      return await loadExternal();
    } catch (externalError) {
      const internalMessage = internalError instanceof Error ? internalError.message : String(internalError);
      const externalMessage = externalError instanceof Error ? externalError.message : String(externalError);
      throw new Error(
        [
          `Evolution dependency unavailable for ${featureName}.`,
          'Install optional package "librainian-devtools" or run from a full source checkout.',
          `Internal load error: ${internalMessage}`,
          `External load error: ${externalMessage}`,
        ].join(' ')
      );
    }
  }
}
