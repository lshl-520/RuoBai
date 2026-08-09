function normalizePath(value) {
  return String(value || "")
    .replaceAll("\\\\", "/")
    .split("/")
    .filter(Boolean);
}

function isSafePathSegments(segments) {
  return segments.length > 0 && !segments.some((segment) => segment === "." || segment === "..");
}

export function toModelRelativePath(filePath, modelPath = "") {
  const fileSegments = normalizePath(filePath);
  const modelSegments = normalizePath(modelPath);
  const modelDirectory = modelSegments.slice(0, -1);
  const hasModelDirectory = modelDirectory.length > 0;
  const startsAtModelDirectory = hasModelDirectory
    && fileSegments.slice(0, modelDirectory.length).join("/") === modelDirectory.join("/");
  const relativeSegments = startsAtModelDirectory
    ? fileSegments.slice(modelDirectory.length)
    : fileSegments;

  if (!isSafePathSegments(relativeSegments)) {
    throw new Error("Live2D 文件路径不安全");
  }

  return relativeSegments.join("/");
}

function getMotionDefinitions(manifest) {
  const paths = Array.isArray(manifest?.motionPaths) ? manifest.motionPaths : [];
  return paths
    .map((filePath) => toModelRelativePath(filePath, manifest?.modelPath))
    .filter(Boolean)
    .map((filePath) => ({ File: filePath }));
}

function getExpressionDefinitions(manifest) {
  const paths = Array.isArray(manifest?.expressionPaths) ? manifest.expressionPaths : [];
  return paths
    .map((filePath) => {
      const relativePath = toModelRelativePath(filePath, manifest?.modelPath);
      const name = relativePath.split("/").pop()?.replace(/\.exp3\.json$/i, "") || relativePath;
      return { Name: name, File: relativePath };
    })
    .filter((item) => item.File);
}

export function buildLive2DModelJson(source, { modelUrl = "", manifest = null } = {}) {
  const json = JSON.parse(JSON.stringify(source || {}));
  const references = json.FileReferences || (json.FileReferences = {});
  if (modelUrl) json.url = modelUrl;

  const motionDefinitions = getMotionDefinitions(manifest);
  if (motionDefinitions.length) {
    const motions = references.Motions && typeof references.Motions === "object"
      ? references.Motions
      : {};
    if (!Array.isArray(motions.Idle) || motions.Idle.length === 0) {
      motions.Idle = motionDefinitions;
    }
    references.Motions = motions;
  }

  const expressionDefinitions = getExpressionDefinitions(manifest);
  if (expressionDefinitions.length) {
    const expressions = Array.isArray(references.Expressions) ? references.Expressions : [];
    const existingFiles = new Set(expressions.map((item) => item?.File).filter(Boolean));
    for (const definition of expressionDefinitions) {
      if (!existingFiles.has(definition.File)) {
        expressions.push(definition);
      }
    }
    references.Expressions = expressions;
  }

  return json;
}
