#!/usr/bin/env bash
# Adaptation + vertical trim regression gate (run after every adaptation-closure phase).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> TypeScript"
npx tsc --noEmit

echo "==> Vitest (adaptation + vertical trim suite)"
npx vitest run \
  src/utils/__tests__/textVerticalTrim.test.ts \
  src/utils/__tests__/layoutEngineTruncate.test.ts \
  src/utils/__tests__/textFit.test.ts \
  src/components/editor/canvas/textTransformUtils.test.ts \
  src/services/customResizeService.test.ts \
  src/utils/constraintInference.test.ts \
  src/utils/__tests__/constraintKernel.test.ts \
  src/store/canvas/__tests__/createSmartResize.test.ts \
  src/utils/__tests__/layoutEngineConstraints.test.ts \
  src/utils/__tests__/layoutEngineHug.test.ts \
  src/utils/__tests__/layoutEngineTextAlignment.test.ts \
  src/utils/__tests__/canvasState.test.ts

echo "==> Gate passed"
