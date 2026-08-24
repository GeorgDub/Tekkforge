export function backupDateiname(original: string, zeit: Date | number): string;
export function backupInfo(dateiname: string): { original: string; wann: Date } | null;
export function zuLoeschen(dateinamen: readonly string[], original: string, max: number): string[];
