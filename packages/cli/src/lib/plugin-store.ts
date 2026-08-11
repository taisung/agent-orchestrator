/** Import a configured plugin already resolvable from the AO installation. */
export async function importPluginModuleFromSource(specifier: string): Promise<unknown> {
  return import(specifier);
}
