/** Save text as a file through a temporary link. A UTF-8 BOM is added for CSV so spreadsheets read non-ASCII text. */
export function download(name: string, text: string, type = 'application/json'): void {
  const body = type.startsWith('text/csv') ? `\uFEFF${text}` : text
  const url = URL.createObjectURL(new Blob([body], { type: type.includes('charset') ? type : `${type};charset=utf-8` }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}
