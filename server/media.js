import express from 'express';
import { ensurePreview, ensureThumbnail } from './image-assets.js';

export function createMediaRouter(options = {}) {
  const router = express.Router();
  const createThumbnail = options.ensureThumbnail || ensureThumbnail;
  const createPreview = options.ensurePreview || ensurePreview;

  router.get('/thumbnail', async (req, res, next) => {
    try {
      const thumbnailPath = await createThumbnail(req.query.path);
      res.set('Cache-Control', 'private, max-age=86400');
      return res.type('webp').sendFile(thumbnailPath);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return res.status(404).json({ success: false, error: '图片不存在' });
      }
      if (error?.statusCode) {
        return res.status(error.statusCode).json({ success: false, error: error.message });
      }
      return next(error);
    }
  });

  router.get('/preview', async (req, res, next) => {
    try {
      const previewPath = await createPreview(req.query.path);
      res.set('Cache-Control', 'private, max-age=86400');
      return res.type('webp').sendFile(previewPath);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return res.status(404).json({ success: false, error: '图片不存在' });
      }
      if (error?.statusCode) {
        return res.status(error.statusCode).json({ success: false, error: error.message });
      }
      return next(error);
    }
  });

  return router;
}

export default createMediaRouter();
