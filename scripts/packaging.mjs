#!/usr/bin/env node
/**
 * Generates the package-manager manifests for a release.
 *
 * ## Why a generator rather than checked-in manifests
 *
 * Because every one of these files is mostly a checksum. A winget manifest, a
 * Homebrew cask and a PKGBUILD each carry a download URL and the SHA-256 of the
 * file at it — and a manifest committed with a placeholder hash is not a
 * manifest, it is a file that will be wrong on the day somebody trusts it.
 *
 * So the manifests are derived from artefacts that actually exist. Point this
 * at the installers `tauri build` produced and it hashes them itself; there is
 * no step where a human copies a hash and no opportunity to copy it wrongly.
 *
 * ## What is still blocked, stated plainly
 *
 * Publishing. Each of these ecosystems needs something this repository does not
 * have and cannot create:
 *
 * - **winget** — a pull request to `microsoft/winget-pkgs`, which requires the
 *   installer to be at a stable public URL. That means a published GitHub
 *   release.
 * - **Homebrew** — a tap, or a pull request to `homebrew-cask`. The cask also
 *   requires the app to be signed and notarised, which needs an Apple Developer
 *   certificate.
 * - **AUR** — an AUR account with an SSH key registered against it.
 *
 * None of those is code. The manifests are the part that is, and they are
 * complete: given a release, each of these files is ready to submit unchanged.
 *
 * ## Usage
 *
 *   pnpm packaging --version 0.1.0 --repo MadBlast0/MadMusic
 *   pnpm packaging --version 0.1.0 --dir src-tauri/target/release/bundle
 */

import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'packaging');

function flag(name, fallback = '') {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : (process.argv[at + 1] ?? fallback);
}

const VERSION = flag('version');
const REPO = flag('repo', 'MadBlast0/MadMusic');
const BUNDLE = join(ROOT, flag('dir', 'src-tauri/target/release/bundle'));

if (!VERSION) {
  console.error('Give a version: --version 0.1.0');
  process.exit(1);
}

/** Every file under a directory, recursively. */
async function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(path)));
    else out.push(path);
  }
  return out;
}

/**
 * Finds one built artefact and hashes it.
 *
 * Returns null rather than throwing when it is not there: a build on Windows
 * produces no `.dmg`, and a generator that failed because of that would be
 * unusable on every machine.
 */
async function artefact(files, extension) {
  const found = files.find((path) => path.toLowerCase().endsWith(extension));
  if (!found) return null;

  const bytes = await readFile(found);
  return {
    path: found,
    name: found.split(/[\\/]/).pop(),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
  };
}

const files = await walk(BUNDLE);
const msi = await artefact(files, '.msi');
const nsis = await artefact(files, '-setup.exe');
const dmg = await artefact(files, '.dmg');
const deb = await artefact(files, '.deb');
const appimage = await artefact(files, '.appimage');

const release = `https://github.com/${REPO}/releases/download/v${VERSION}`;

await mkdir(OUT, { recursive: true });

/* ── winget ─────────────────────────────────────────────────────────────── */

/**
 * The manifest is three files in winget's schema, not one.
 *
 * Written as separate documents rather than a multi-document YAML: that is how
 * `winget-pkgs` stores them, and a submission has to match the directory layout
 * as well as the schema.
 */
const wingetInstaller = msi ?? nsis;
if (wingetInstaller) {
  const kind = msi ? 'wix' : 'nullsoft';

  await writeFile(
    join(OUT, 'MadBlast.MadMusic.installer.yaml'),
    `# yaml-language-server: $schema=https://aka.ms/winget-manifest.installer.1.6.0.schema.json
PackageIdentifier: MadBlast.MadMusic
PackageVersion: ${VERSION}
InstallerType: ${kind}
Scope: user
InstallModes:
  - interactive
  - silent
UpgradeBehavior: install
ReleaseDate: ${new Date().toISOString().slice(0, 10)}
Installers:
  - Architecture: x64
    InstallerUrl: ${release}/${wingetInstaller.name}
    InstallerSha256: ${wingetInstaller.sha256.toUpperCase()}
ManifestType: installer
ManifestVersion: 1.6.0
`,
  );

  await writeFile(
    join(OUT, 'MadBlast.MadMusic.locale.en-US.yaml'),
    `# yaml-language-server: $schema=https://aka.ms/winget-manifest.defaultLocale.1.6.0.schema.json
PackageIdentifier: MadBlast.MadMusic
PackageVersion: ${VERSION}
PackageLocale: en-US
Publisher: MadBlast
PublisherUrl: https://github.com/${REPO.split('/')[0]}
PackageName: MadMusic
PackageUrl: https://github.com/${REPO}
License: Proprietary
ShortDescription: One music library, every device.
Description: |-
  A local-first music player. Plays the files in your own folder, and streams
  from a catalogue when you ask it to. No account, no subscription, and nothing
  leaves the machine unless a setting says it will.
Tags:
  - music
  - player
  - audio
  - offline
ManifestType: defaultLocale
ManifestVersion: 1.6.0
`,
  );

  await writeFile(
    join(OUT, 'MadBlast.MadMusic.yaml'),
    `# yaml-language-server: $schema=https://aka.ms/winget-manifest.version.1.6.0.schema.json
PackageIdentifier: MadBlast.MadMusic
PackageVersion: ${VERSION}
DefaultLocale: en-US
ManifestType: version
ManifestVersion: 1.6.0
`,
  );
}

/* ── Homebrew ───────────────────────────────────────────────────────────── */

if (dmg) {
  await writeFile(
    join(OUT, 'madmusic.rb'),
    `# A Homebrew cask. Submit to a tap, or to homebrew-cask once the app is
# signed and notarised — an unsigned cask is rejected, and notarisation needs an
# Apple Developer certificate this repository does not have.
cask "madmusic" do
  version "${VERSION}"
  sha256 "${dmg.sha256}"

  url "${release}/${dmg.name}"
  name "MadMusic"
  desc "One music library, every device"
  homepage "https://github.com/${REPO}"

  app "MadMusic.app"

  zap trash: [
    "~/Library/Application Support/com.madblast.madmusic",
    "~/Library/Caches/com.madblast.madmusic",
    "~/Library/Preferences/com.madblast.madmusic.plist",
  ]
end
`,
  );
}

/* ── AUR ────────────────────────────────────────────────────────────────── */

if (deb || appimage) {
  const source = deb ?? appimage;
  await writeFile(
    join(OUT, 'PKGBUILD'),
    `# Maintainer: MadBlast <81722794+MadBlast0@users.noreply.github.com>
#
# Submit to the AUR with an account and a registered SSH key. The package name
# ends in \`-bin\` because it installs a prebuilt binary rather than compiling
# from source, which is the AUR's convention and not optional.
pkgname=madmusic-bin
pkgver=${VERSION}
pkgrel=1
pkgdesc="One music library, every device"
arch=('x86_64')
url="https://github.com/${REPO}"
license=('LicenseRef-Proprietary')
depends=('webkit2gtk-4.1' 'gtk3' 'libayatana-appindicator')
provides=('madmusic')
conflicts=('madmusic')
source_x86_64=("${release}/${source.name}")
sha256sums_x86_64=('${source.sha256}')

package() {
  ${
    deb
      ? `# The .deb is an ar archive of two tarballs; the payload is data.tar.*
  bsdtar -O -xf "\${srcdir}/${source.name}" data.tar.gz | bsdtar -C "\${pkgdir}" -xJf -`
      : `install -Dm755 "\${srcdir}/${source.name}" "\${pkgdir}/usr/bin/madmusic"`
  }
}
`,
  );
}

/* ── what happened ──────────────────────────────────────────────────────── */

const made = [
  wingetInstaller && `winget (${wingetInstaller.name})`,
  dmg && `Homebrew cask (${dmg.name})`,
  deb && `PKGBUILD (${deb.name})`,
  !deb && appimage && `PKGBUILD (${appimage.name})`,
].filter(Boolean);

if (made.length === 0) {
  console.error(
    `No installers found under ${BUNDLE}.\n` +
      'Run `pnpm tauri build` first — this hashes real artefacts rather than\n' +
      'writing placeholder checksums, which is the whole point.',
  );
  process.exit(1);
}

console.log(`Wrote manifests to ${OUT}:`);
for (const entry of made) console.log(`  ${entry}`);
console.log(
  '\nEach is ready to submit unchanged. Publishing needs credentials this\n' +
    'repository does not have — see the note at the top of this script.',
);
