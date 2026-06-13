const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const cors = require('cors');
const archiver = require('archiver');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 8720;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'output');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const sessionId = req.headers['x-session-id'] || uuidv4();
    const sessionDir = path.join(UPLOAD_DIR, sessionId);
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }
    cb(null, sessionDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}_${uuidv4().slice(0, 8)}_${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp|bmp|tiff/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    } else {
      cb(new Error('不支持的图片格式'));
    }
  }
});

function cleanOldFiles(directory, maxAgeMs) {
  const now = Date.now();
  function walkDir(dir) {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        walkDir(fullPath);
        const remaining = fs.readdirSync(fullPath);
        if (remaining.length === 0) {
          fs.rmdirSync(fullPath);
        }
      } else {
        const age = now - stat.mtimeMs;
        if (age > maxAgeMs) {
          fs.unlinkSync(fullPath);
        }
      }
    }
  }
  try {
    if (fs.existsSync(directory)) {
      walkDir(directory);
    }
  } catch (err) {
    console.error('清理文件时出错:', err.message);
  }
}

const CACHE_MAX_AGE = 60 * 60 * 1000;
setInterval(() => {
  console.log('[缓存清理] 开始清理过期文件...');
  cleanOldFiles(UPLOAD_DIR, CACHE_MAX_AGE);
  cleanOldFiles(OUTPUT_DIR, CACHE_MAX_AGE);
  console.log('[缓存清理] 清理完成');
}, 30 * 60 * 1000);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: '图片处理服务运行正常' });
});

app.post('/api/upload', upload.array('images', 100), (req, res) => {
  try {
    const files = req.files || [];
    const sessionId = req.headers['x-session-id'] || uuidv4();
    const fileList = files.map((file, index) => ({
      id: uuidv4(),
      name: file.originalname,
      path: file.path,
      filename: file.filename,
      size: file.size,
      mimetype: file.mimetype,
      index: index
    }));
    res.json({
      success: true,
      sessionId: sessionId,
      files: fileList
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/merge', upload.none(), async (req, res) => {
  try {
    const { images, direction = 'horizontal', margin = 0, bgColor = '#ffffff', order = 'original' } = req.body;
    
    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ success: false, error: '请提供至少一张图片' });
    }

    let imageList = [...images];
    
    if (order === 'name') {
      imageList.sort((a, b) => a.name.localeCompare(b.name));
    } else if (order === 'size') {
      imageList.sort((a, b) => b.size - a.size);
    } else if (order === 'reverse') {
      imageList.reverse();
    }

    const imageInfos = [];
    for (const img of imageList) {
      const metadata = await sharp(img.path).metadata();
      imageInfos.push({
        path: img.path,
        width: metadata.width,
        height: metadata.height,
        channels: metadata.channels
      });
    }

    let totalWidth, totalHeight;
    if (direction === 'horizontal') {
      totalWidth = imageInfos.reduce((sum, img) => sum + img.width, 0) + margin * (imageInfos.length + 1);
      totalHeight = Math.max(...imageInfos.map(img => img.height)) + margin * 2;
    } else {
      totalWidth = Math.max(...imageInfos.map(img => img.width)) + margin * 2;
      totalHeight = imageInfos.reduce((sum, img) => sum + img.height, 0) + margin * (imageInfos.length + 1);
    }

    const bgColorHex = bgColor.startsWith('#') ? bgColor : `#${bgColor}`;
    const hasAlpha = imageInfos.some(img => img.channels === 4);
    const outputFormat = hasAlpha ? 'png' : 'jpeg';

    let canvas = sharp({
      create: {
        width: totalWidth,
        height: totalHeight,
        channels: hasAlpha ? 4 : 3,
        background: bgColorHex
      }
    });

    const composites = [];
    let currentPos = margin;

    for (const imgInfo of imageInfos) {
      let x, y;
      if (direction === 'horizontal') {
        x = currentPos;
        y = margin + Math.floor((totalHeight - margin * 2 - imgInfo.height) / 2);
        currentPos += imgInfo.width + margin;
      } else {
        x = margin + Math.floor((totalWidth - margin * 2 - imgInfo.width) / 2);
        y = currentPos;
        currentPos += imgInfo.height + margin;
      }

      composites.push({
        input: imgInfo.path,
        left: x,
        top: y
      });
    }

    const outputId = uuidv4();
    const outputPath = path.join(OUTPUT_DIR, `${outputId}.${outputFormat}`);

    await canvas.composite(composites).toFile(outputPath);

    const outputFilename = `merged_${Date.now()}.${outputFormat}`;
    
    res.json({
      success: true,
      outputId: outputId,
      filename: outputFilename,
      path: outputPath,
      url: `/api/download/${outputId}.${outputFormat}`,
      width: totalWidth,
      height: totalHeight,
      format: outputFormat
    });
  } catch (err) {
    console.error('拼接失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/split', upload.none(), async (req, res) => {
  try {
    const { image, rows = 2, cols = 2 } = req.body;
    
    if (!image || !image.path) {
      return res.status(400).json({ success: false, error: '请提供图片' });
    }

    if (rows < 1 || cols < 1 || rows > 20 || cols > 20) {
      return res.status(400).json({ success: false, error: '行列数必须在1-20之间' });
    }

    const metadata = await sharp(image.path).metadata();
    const { width, height, format, channels } = metadata;

    const pieceWidth = Math.floor(width / cols);
    const pieceHeight = Math.floor(height / rows);

    const outputId = uuidv4();
    const outputDir = path.join(OUTPUT_DIR, outputId);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const pieces = [];
    const tasks = [];

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = col * pieceWidth;
        const y = row * pieceHeight;
        const pieceName = `piece_${row + 1}_${col + 1}.${format || 'png'}`;
        const piecePath = path.join(outputDir, pieceName);

        const task = sharp(image.path)
          .extract({
            left: x,
            top: y,
            width: (col === cols - 1) ? (width - x) : pieceWidth,
            height: (row === rows - 1) ? (height - y) : pieceHeight
          })
          .toFile(piecePath);

        pieces.push({
          row: row + 1,
          col: col + 1,
          name: pieceName,
          path: piecePath,
          x: x,
          y: y,
          width: (col === cols - 1) ? (width - x) : pieceWidth,
          height: (row === rows - 1) ? (height - y) : pieceHeight
        });

        tasks.push(task);
      }
    }

    await Promise.all(tasks);

    const zipName = `split_${Date.now()}.zip`;
    const zipPath = path.join(OUTPUT_DIR, `${outputId}.zip`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    const stream = fs.createWriteStream(zipPath);
    archive.pipe(stream);

    for (const piece of pieces) {
      archive.file(piece.path, { name: piece.name });
    }

    await archive.finalize();

    res.json({
      success: true,
      outputId: outputId,
      pieces: pieces,
      zipUrl: `/api/download/${outputId}.zip`,
      zipName: zipName,
      pieceWidth: pieceWidth,
      pieceHeight: pieceHeight,
      rows: rows,
      cols: cols,
      originalWidth: width,
      originalHeight: height
    });
  } catch (err) {
    console.error('分割失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/batch-merge', upload.none(), async (req, res) => {
  try {
    const { groups } = req.body;
    
    if (!groups || !Array.isArray(groups) || groups.length === 0) {
      return res.status(400).json({ success: false, error: '请提供拼接组' });
    }

    const outputId = uuidv4();
    const outputDir = path.join(OUTPUT_DIR, outputId);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const results = [];

    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const { images, direction = 'horizontal', margin = 0, bgColor = '#ffffff' } = group;

      if (!images || images.length === 0) continue;

      const imageInfos = [];
      for (const img of images) {
        const metadata = await sharp(img.path).metadata();
        imageInfos.push({
          path: img.path,
          width: metadata.width,
          height: metadata.height,
          channels: metadata.channels
        });
      }

      let totalWidth, totalHeight;
      if (direction === 'horizontal') {
        totalWidth = imageInfos.reduce((sum, img) => sum + img.width, 0) + margin * (imageInfos.length + 1);
        totalHeight = Math.max(...imageInfos.map(img => img.height)) + margin * 2;
      } else {
        totalWidth = Math.max(...imageInfos.map(img => img.width)) + margin * 2;
        totalHeight = imageInfos.reduce((sum, img) => sum + img.height, 0) + margin * (imageInfos.length + 1);
      }

      const bgColorHex = bgColor.startsWith('#') ? bgColor : `#${bgColor}`;
      const hasAlpha = imageInfos.some(img => img.channels === 4);
      const outputFormat = hasAlpha ? 'png' : 'jpeg';

      let canvas = sharp({
        create: {
          width: totalWidth,
          height: totalHeight,
          channels: hasAlpha ? 4 : 3,
          background: bgColorHex
        }
      });

      const composites = [];
      let currentPos = margin;

      for (const imgInfo of imageInfos) {
        let x, y;
        if (direction === 'horizontal') {
          x = currentPos;
          y = margin + Math.floor((totalHeight - margin * 2 - imgInfo.height) / 2);
          currentPos += imgInfo.width + margin;
        } else {
          x = margin + Math.floor((totalWidth - margin * 2 - imgInfo.width) / 2);
          y = currentPos;
          currentPos += imgInfo.height + margin;
        }

        composites.push({
          input: imgInfo.path,
          left: x,
          top: y
        });
      }

      const outputFilename = `merged_group_${i + 1}.${outputFormat}`;
      const outputPath = path.join(outputDir, outputFilename);

      await canvas.composite(composites).toFile(outputPath);

      results.push({
        groupIndex: i + 1,
        filename: outputFilename,
        path: outputPath,
        width: totalWidth,
        height: totalHeight
      });
    }

    const zipName = `batch_merge_${Date.now()}.zip`;
    const zipPath = path.join(OUTPUT_DIR, `${outputId}.zip`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    const stream = fs.createWriteStream(zipPath);
    archive.pipe(stream);

    for (const result of results) {
      archive.file(result.path, { name: result.filename });
    }

    await archive.finalize();

    res.json({
      success: true,
      outputId: outputId,
      results: results,
      zipUrl: `/api/download/${outputId}.zip`,
      zipName: zipName
    });
  } catch (err) {
    console.error('批量拼接失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(OUTPUT_DIR, filename);
  
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    res.download(filePath, filename, (err) => {
      if (err) {
        res.status(404).json({ success: false, error: '文件不存在' });
      }
    });
  } else {
    const dirPath = path.join(OUTPUT_DIR, filename.replace(/\.[^/.]+$/, ''));
    if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
      const zipPath = path.join(OUTPUT_DIR, `${filename.replace(/\.[^/.]+$/, '')}.zip`);
      if (fs.existsSync(zipPath)) {
        return res.download(zipPath, filename, (err) => {
          if (err) {
            res.status(404).json({ success: false, error: '文件不存在' });
          }
        });
      }
    }
    res.status(404).json({ success: false, error: '文件不存在' });
  }
});

app.get('/api/preview/:filename', (req, res) => {
  const filename = req.params.filename;
  const width = parseInt(req.query.w) || 0;
  const height = parseInt(req.query.h) || 0;
  const filePath = path.join(OUTPUT_DIR, filename);
  const uploadFilePath = path.join(UPLOAD_DIR, filename);
  
  let sourcePath = null;
  if (fs.existsSync(filePath)) {
    sourcePath = filePath;
  } else if (fs.existsSync(uploadFilePath)) {
    sourcePath = uploadFilePath;
  } else {
    const subDirPath = findFileInDir(OUTPUT_DIR, filename);
    if (subDirPath) {
      sourcePath = subDirPath;
    }
  }

  if (sourcePath) {
    if (width > 0 || height > 0) {
      const thumbnail = sharp(sourcePath);
      if (width > 0 && height > 0) {
        thumbnail.resize(width, height, { fit: 'inside' });
      } else if (width > 0) {
        thumbnail.resize(width, null);
      } else {
        thumbnail.resize(null, height);
      }
      res.set('Content-Type', 'image/jpeg');
      thumbnail.jpeg({ quality: 80 }).pipe(res);
    } else {
      res.sendFile(sourcePath);
    }
  } else {
    res.status(404).json({ success: false, error: '文件不存在' });
  }
});

function findFileInDir(dir, filename) {
  if (!fs.existsSync(dir)) return null;
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      const found = findFileInDir(fullPath, filename);
      if (found) return found;
    } else if (item === filename) {
      return fullPath;
    }
  }
  return null;
}

app.post('/api/convert', upload.none(), async (req, res) => {
  try {
    const { image, format = 'jpeg', quality = 90 } = req.body;
    
    if (!image || !image.path) {
      return res.status(400).json({ success: false, error: '请提供图片' });
    }

    const outputId = uuidv4();
    const outputPath = path.join(OUTPUT_DIR, `${outputId}.${format}`);

    let converter = sharp(image.path);
    
    if (format === 'jpeg' || format === 'jpg') {
      converter = converter.jpeg({ quality: parseInt(quality) });
    } else if (format === 'png') {
      converter = converter.png({ quality: parseInt(quality) });
    } else if (format === 'webp') {
      converter = converter.webp({ quality: parseInt(quality) });
    }

    await converter.toFile(outputPath);

    const metadata = await sharp(outputPath).metadata();

    res.json({
      success: true,
      outputId: outputId,
      format: format,
      width: metadata.width,
      height: metadata.height,
      path: outputPath,
      url: `/api/download/${outputId}.${format}`
    });
  } catch (err) {
    console.error('格式转换失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.use('/static', express.static(OUTPUT_DIR));
app.use('/uploads', express.static(UPLOAD_DIR));

const CLIENT_DIR = path.join(__dirname, '..', 'client');
app.use(express.static(CLIENT_DIR));

app.get('/', (req, res) => {
  res.sendFile(path.join(CLIENT_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`图片处理服务已启动: http://localhost:${PORT}`);
  console.log(`上传目录: ${UPLOAD_DIR}`);
  console.log(`输出目录: ${OUTPUT_DIR}`);
});
