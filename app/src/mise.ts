// Reads the [tools] table of config/mise.toml so the Runtimes step can show
// what it will install without repeating the versions anywhere else.

export function parseMiseTools(text: string): string[] {
  const tools: string[] = [];
  let inTools = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (/^\[.*\]$/.test(line)) {
      inTools = line === '[tools]';
      continue;
    }
    if (!inTools || !line || line.startsWith('#')) continue;
    const m = /^"?([^"=\s]+)"?\s*=\s*"([^"]*)"/.exec(line);
    if (m) tools.push(`${m[1].replace(/^npm:/, '')} ${m[2]}`.trim());
  }
  return tools;
}
