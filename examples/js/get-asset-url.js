const ASSETS_BASE = "/spark-effects-thumbnails/examples";

export async function getAssetFileURL(assetFile) {
  try {
    const response = await fetch(`${ASSETS_BASE}/assets.json`);
    const assetsDirectory = `${ASSETS_BASE}/assets/`;
    const assetsInfo = await response.json();
    let url = assetsInfo[assetFile].url;
    if (window.sparkLocalAssets) {
      url = `${assetsDirectory}${assetsInfo[assetFile].directory}/${assetFile}`;
    }
    return url;
  } catch (error) {
    console.error("Failed to load asset file URL:", error);
    return null;
  }
}
