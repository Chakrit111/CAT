// Publishes a pet's built exe as a GitHub release, which running copies of that pet then update
// themselves from (src/main/update.ts). Build first: npm run build-pet -- <id>
// usage: node scripts/publish-pet.mjs <id> [--notes "what changed"] [--dry-run]
//        (npm run publish-pet -- <id>)
// Needs the gh CLI, signed in. The release is public the moment this runs: tag <id>-v<version>
// in the repository named by pet.json "update.repo", with the exe and its .sha256.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPet, exeName, report } from './check-pet.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const id = args[0];
if (!id || id.startsWith('-')) {
  console.error('usage: npm run publish-pet -- <id> [--notes "what changed"] [--dry-run]');
  process.exit(2);
}
const notesAt = args.indexOf('--notes');
const dryRun = args.includes('--dry-run');

const result = checkPet(root, id);
if (result.errors.length) {
  report(id, result);
  process.exit(1);
}
const pet = result.pet;
const repo = pet.update?.repo;
if (!repo) {
  console.error(`pets/${id}/pet.json has no "update": { "repo": "owner/name" }: nowhere to publish to.`);
  process.exit(1);
}
const exe = path.join(root, 'release', id, exeName(pet));
const shaFile = `${exe}.sha256`;
if (!existsSync(exe) || !existsSync(shaFile)) {
  console.error(`Build it first (npm run build-pet -- ${id}): missing ${exe} or its .sha256`);
  process.exit(1);
}
// The exe must be the one the checksum was made from, or every pet would refuse the update.
const sha = createHash('sha256').update(readFileSync(exe)).digest('hex');
if (!readFileSync(shaFile, 'utf8').startsWith(sha)) {
  console.error(`${shaFile} does not match the exe. Build again.`);
  process.exit(1);
}

const tag = `${id}-v${pet.version}`;
const notes = notesAt >= 0 && args[notesAt + 1] ? args[notesAt + 1] : `${pet.productName} ${pet.version}`;
const gh = ['release', 'create', tag, exe, shaFile, '--repo', repo, '--title', `${pet.productName} ${pet.version}`, '--notes', notes];
console.log(`${dryRun ? 'would run' : 'running'}: gh ${gh.join(' ')}`);
if (!dryRun) {
  execFileSync('gh', gh, { stdio: 'inherit' });
  console.log(`\npublished ${tag}. Running copies older than ${pet.version} pick it up within 6 hours.`);
}
