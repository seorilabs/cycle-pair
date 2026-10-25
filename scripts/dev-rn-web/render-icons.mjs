import { Resvg } from "@resvg/resvg-js";
import { readdir, readFile, writeFile } from "node:fs/promises";
const directory = new URL(
  "../../apps/mobile/src/assets/brand/icons/",
  import.meta.url
);
for (const filename of await readdir(directory)) {
  if (!filename.endsWith(".svg")) continue;
  const svg = await readFile(new URL(filename, directory), "utf8");
  const png = new Resvg(svg, { fitTo: { mode: "width", value: 96 } })
    .render()
    .asPng();
  await writeFile(new URL(filename.replace(".svg", ".png"), directory), png);
}
