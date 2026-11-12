// Stylized body figure for the home-screen hologram. All shapes are drawn for
// the LEFT half of a 200 × 460 canvas (x < 100) and mirrored across x = 100,
// so every muscle is defined once and stays symmetric.

import type { Muscle } from "../api";

export const VIEW_W = 200;
export const VIEW_H = 460;

/** Head is drawn whole (not mirrored). */
export const HEAD = { cx: 100, cy: 36, rx: 19, ry: 25 };

/** Left half of the silhouette, from the neck down to the crotch. */
export const OUTLINE_HALF =
  "M100,61 L91,63 Q91,74 86,79 L70,83 Q50,84 44,100 Q39,128 42,168 " +
  "Q35,200 31,246 Q29,262 35,268 Q42,263 41,250 Q47,214 53,182 " +
  "Q59,160 61,140 L63,198 Q60,224 62,244 Q57,290 64,330 Q59,372 66,420 " +
  "Q61,432 66,439 L83,439 Q85,421 82,410 Q88,372 86,336 Q92,300 96,260 L100,257";

export interface MuscleShape {
  muscle: Muscle;
  d: string; // left-half path; the renderer mirrors it
}

export const FRONT: MuscleShape[] = [
  { muscle: "traps", d: "M91,66 Q90,76 85,80 L73,84 Q86,86 96,82 Z" },
  { muscle: "shoulders", d: "M70,86 Q52,86 47,104 Q47,119 54,125 Q59,108 72,97 Z" },
  { muscle: "chest", d: "M98,92 L76,92 Q61,100 59,120 Q67,137 84,139 Q96,139 98,131 Z" },
  { muscle: "biceps", d: "M54,129 Q46,142 45,164 Q49,171 55,169 Q61,150 60,132 Z" },
  { muscle: "forearms", d: "M44,176 Q37,203 35,240 L42,242 Q49,212 53,179 Z" },
  // Six-pack: three blocks per side plus the lower V.
  { muscle: "abs", d: "M86,144 L98,144 L98,163 L86,163 Q85,153 86,144 Z" },
  { muscle: "abs", d: "M86,167 L98,167 L98,187 L86,187 Q85,177 86,167 Z" },
  { muscle: "abs", d: "M87,191 L98,191 L98,212 L88,212 Q86,201 87,191 Z" },
  { muscle: "abs", d: "M88,216 L98,216 L98,244 Q91,236 88,216 Z" },
  { muscle: "obliques", d: "M83,146 Q72,162 70,198 Q74,218 84,228 Q82,186 83,146 Z" },
  { muscle: "quads", d: "M91,262 Q72,258 67,282 Q63,310 71,330 Q81,338 90,330 Q96,300 96,266 Z" },
  { muscle: "calves", d: "M70,350 Q64,376 70,410 L78,412 Q84,380 82,350 Z" },
];

export const BACK: MuscleShape[] = [
  { muscle: "traps", d: "M100,68 L90,72 Q88,80 72,85 Q88,96 100,128 Z" },
  { muscle: "shoulders", d: "M70,86 Q52,86 47,104 Q47,119 54,125 Q59,108 72,97 Z" },
  { muscle: "lats", d: "M73,99 Q61,128 70,168 Q82,194 96,203 L97,150 Q86,118 75,99 Z" },
  { muscle: "triceps", d: "M54,129 Q46,142 46,166 Q52,173 58,167 Q62,148 60,131 Z" },
  { muscle: "forearms", d: "M44,176 Q37,203 35,240 L42,242 Q49,212 53,179 Z" },
  { muscle: "lower_back", d: "M89,207 Q86,222 90,236 L99,239 L99,208 Z" },
  { muscle: "glutes", d: "M99,242 Q79,238 67,250 Q63,270 75,281 Q90,287 99,277 Z" },
  { muscle: "hamstrings", d: "M95,288 Q76,286 69,298 Q65,320 72,336 Q84,341 93,332 Q97,310 95,288 Z" },
  { muscle: "calves", d: "M70,348 Q60,371 68,396 Q76,403 82,394 Q86,370 82,348 Z" },
];
