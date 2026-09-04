import { readdir, rm } from 'node:fs/promises'
import path from 'node:path'

const roots = ['apps', 'packages']
for (const root of roots) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      await rm(path.join(root, entry.name, 'dist'), { recursive: true, force: true })
    }
  }
}
