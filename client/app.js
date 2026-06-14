const API_BASE = `${window.location.origin}/api`;

let mergeImages = [];
let splitImage = null;
let mergeResult = null;
let splitResult = null;
let mergeDirection = 'horizontal';
let batchMode = 'single';
let batchMergeResult = null;

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.style.display = 'block';
  setTimeout(() => {
    toast.style.display = 'none';
  }, 3000);
}

function showLoading(text = '处理中...') {
  document.getElementById('loading-text').textContent = text;
  document.getElementById('loading-overlay').style.display = 'flex';
}

function hideLoading() {
  document.getElementById('loading-overlay').style.display = 'none';
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function generateSessionId() {
  return 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

let sessionId = localStorage.getItem('imageToolSessionId') || generateSessionId();
localStorage.setItem('imageToolSessionId', sessionId);

function initTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      const tabName = btn.dataset.tab;
      document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
      });
      document.getElementById(tabName + '-tab').classList.add('active');
    });
  });
}

function initUploadAreas() {
  initMergeUpload();
  initSplitUpload();
}

function initMergeUpload() {
  const uploadArea = document.getElementById('merge-upload');
  const fileInput = document.getElementById('merge-file-input');

  uploadArea.addEventListener('click', () => fileInput.click());

  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('drag-over');
  });

  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('drag-over');
  });

  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    handleMergeFiles(files);
  });

  fileInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    handleMergeFiles(files);
    fileInput.value = '';
  });
}

async function handleMergeFiles(files) {
  if (files.length === 0) return;
  
  showLoading('上传中...');
  
  try {
    const formData = new FormData();
    files.forEach(file => {
      formData.append('images', file);
    });

    const response = await fetch(`${API_BASE}/upload`, {
      method: 'POST',
      body: formData,
      headers: {
        'x-session-id': sessionId
      }
    });

    const data = await response.json();
    
    if (data.success) {
      const newImages = data.files.map((f, i) => ({
        ...f,
        previewUrl: URL.createObjectURL(files[i])
      }));
      mergeImages = mergeImages.concat(newImages);
      renderMergeImageList();
      showToast(`成功上传 ${newImages.length} 张图片`, 'success');
    } else {
      showToast('上传失败: ' + data.error, 'error');
    }
  } catch (err) {
    showToast('上传失败: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

function renderMergeImageList() {
  const list = document.getElementById('merge-image-list');
  list.innerHTML = '';

  mergeImages.forEach((img, index) => {
    const item = document.createElement('div');
    item.className = 'image-item';
    item.draggable = true;
    item.dataset.index = index;
    
    item.innerHTML = `
      <div class="index-badge">${index + 1}</div>
      <img src="${img.previewUrl}" alt="${img.name}" loading="lazy">
      <div class="image-name">${img.name}</div>
      <button class="remove-btn" data-index="${index}">×</button>
    `;

    const imgElement = item.querySelector('img');
    if (img.size > 2 * 1024 * 1024) {
      imgElement.style.filter = 'blur(2px)';
      imgElement.style.transition = 'filter 0.3s';
      imgElement.addEventListener('load', () => {
        imgElement.style.filter = 'none';
      });
    }

    item.querySelector('.remove-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      removeMergeImage(index);
    });

    item.addEventListener('dragstart', handleDragStart);
    item.addEventListener('dragend', handleDragEnd);
    item.addEventListener('dragover', handleDragOver);
    item.addEventListener('drop', handleDropOnItem);
    item.addEventListener('dragenter', handleDragEnter);
    item.addEventListener('dragleave', handleDragLeave);

    list.appendChild(item);
  });
}

let draggedIndex = null;

function handleDragStart(e) {
  draggedIndex = parseInt(this.dataset.index);
  this.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function handleDragEnd(e) {
  this.classList.remove('dragging');
  document.querySelectorAll('.image-item').forEach(item => {
    item.classList.remove('drag-over-item');
  });
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

function handleDragEnter(e) {
  e.preventDefault();
  this.classList.add('drag-over-item');
}

function handleDragLeave(e) {
  this.classList.remove('drag-over-item');
}

function handleDropOnItem(e) {
  e.preventDefault();
  this.classList.remove('drag-over-item');
  
  const targetIndex = parseInt(this.dataset.index);
  
  if (draggedIndex !== null && draggedIndex !== targetIndex) {
    const draggedImg = mergeImages[draggedIndex];
    mergeImages.splice(draggedIndex, 1);
    mergeImages.splice(targetIndex, 0, draggedImg);
    renderMergeImageList();
  }
  
  draggedIndex = null;
}

function removeMergeImage(index) {
  mergeImages.splice(index, 1);
  renderMergeImageList();
}

function initSplitUpload() {
  const uploadArea = document.getElementById('split-upload');
  const fileInput = document.getElementById('split-file-input');

  uploadArea.addEventListener('click', () => fileInput.click());

  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('drag-over');
  });

  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('drag-over');
  });

  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (files.length > 0) {
      handleSplitFile(files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleSplitFile(e.target.files[0]);
    }
    fileInput.value = '';
  });
}

async function handleSplitFile(file) {
  showLoading('上传中...');
  
  try {
    const formData = new FormData();
    formData.append('images', file);

    const response = await fetch(`${API_BASE}/upload`, {
      method: 'POST',
      body: formData,
      headers: {
        'x-session-id': sessionId
      }
    });

    const data = await response.json();
    
    if (data.success && data.files.length > 0) {
      splitImage = {
        ...data.files[0],
        previewUrl: URL.createObjectURL(file)
      };
      renderSplitImageList();
      document.getElementById('split-preview-btn').disabled = false;
      showToast('图片上传成功', 'success');
    } else {
      showToast('上传失败: ' + data.error, 'error');
    }
  } catch (err) {
    showToast('上传失败: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

function renderSplitImageList() {
  const list = document.getElementById('split-image-list');
  list.innerHTML = '';

  if (splitImage) {
    const item = document.createElement('div');
    item.className = 'image-item';
    item.style.width = '150px';
    item.style.height = '150px';
    
    item.innerHTML = `
      <img src="${splitImage.previewUrl}" alt="${splitImage.name}">
      <div class="image-name">${splitImage.name}</div>
    `;

    list.appendChild(item);
  }
}

function initSettings() {
  initMergeSettings();
  initSplitSettings();
}

function initMergeSettings() {
  const directionBtns = document.querySelectorAll('[data-direction]');
  directionBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      directionBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      mergeDirection = btn.dataset.direction;
    });
  });

  const batchBtns = document.querySelectorAll('[data-batch]');
  batchBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      batchBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      batchMode = btn.dataset.batch;
      const batchSizeItem = document.getElementById('batch-size-item');
      if (batchMode === 'batch') {
        batchSizeItem.style.display = 'flex';
      } else {
        batchSizeItem.style.display = 'none';
      }
    });
  });

  const bgColorInput = document.getElementById('merge-bgcolor');
  const bgColorText = document.getElementById('merge-bgcolor-text');

  bgColorInput.addEventListener('input', (e) => {
    bgColorText.value = e.target.value;
  });

  bgColorText.addEventListener('input', (e) => {
    let val = e.target.value;
    if (!val.startsWith('#')) val = '#' + val;
    if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
      bgColorInput.value = val;
    }
  });
}

function initSplitSettings() {
  const rowsInput = document.getElementById('split-rows');
  const colsInput = document.getElementById('split-cols');
  const hintRows = document.getElementById('split-hint-rows');
  const hintCols = document.getElementById('split-hint-cols');

  function updateHint() {
    hintRows.textContent = rowsInput.value;
    hintCols.textContent = colsInput.value;
  }

  rowsInput.addEventListener('input', updateHint);
  colsInput.addEventListener('input', updateHint);
}

function initActions() {
  document.getElementById('merge-preview-btn').addEventListener('click', handleMergePreview);
  document.getElementById('merge-download-btn').addEventListener('click', handleMergeDownload);
  document.getElementById('split-preview-btn').addEventListener('click', handleSplit);
  document.getElementById('split-download-btn').addEventListener('click', handleSplitDownload);
}

async function handleMergePreview() {
  if (mergeImages.length < 2) {
    showToast('请至少上传2张图片', 'error');
    return;
  }

  if (batchMode === 'batch') {
    await handleBatchMerge();
  } else {
    await handleSingleMerge();
  }
}

async function handleSingleMerge() {
  showLoading('正在拼接图片...');

  try {
    const margin = parseInt(document.getElementById('merge-margin').value) || 0;
    const bgColor = document.getElementById('merge-bgcolor-text').value || '#ffffff';
    const order = document.getElementById('merge-order').value;

    const response = await fetch(`${API_BASE}/merge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-id': sessionId
      },
      body: JSON.stringify({
        images: mergeImages.map(img => ({
        id: img.id,
        name: img.name,
        path: img.path,
        size: img.size
      })),
        direction: mergeDirection,
        margin: margin,
        bgColor: bgColor,
        order: order
      })
    });

    const data = await response.json();

    if (data.success) {
      mergeResult = data;
      batchMergeResult = null;
      renderSingleMergePreview(data);
      document.getElementById('merge-download-btn').disabled = false;
      showToast('拼接完成', 'success');
    } else {
      showToast('拼接失败: ' + data.error, 'error');
    }
  } catch (err) {
    showToast('拼接失败: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

async function handleBatchMerge() {
  const batchSize = parseInt(document.getElementById('batch-size').value) || 2;
  
  if (mergeImages.length < batchSize) {
    showToast(`图片数量不足，至少需要 ${batchSize} 张图片`, 'error');
    return;
  }

  showLoading('正在批量拼接...');

  try {
    const margin = parseInt(document.getElementById('merge-margin').value) || 0;
    const bgColor = document.getElementById('merge-bgcolor-text').value || '#ffffff';
    const order = document.getElementById('merge-order').value;

    let orderedImages = [...mergeImages];
    if (order === 'name') {
      orderedImages.sort((a, b) => a.name.localeCompare(b.name));
    } else if (order === 'size') {
      orderedImages.sort((a, b) => b.size - a.size);
    } else if (order === 'reverse') {
      orderedImages.reverse();
    }

    const groups = [];
    for (let i = 0; i < orderedImages.length; i += batchSize) {
      const group = orderedImages.slice(i, i + batchSize);
      if (group.length >= 2) {
        groups.push({
          images: group.map(img => ({
            id: img.id,
            name: img.name,
            path: img.path,
            size: img.size
          })),
          direction: mergeDirection,
          margin: margin,
          bgColor: bgColor
        });
      }
    }

    const response = await fetch(`${API_BASE}/batch-merge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-id': sessionId
      },
      body: JSON.stringify({ groups: groups })
    });

    const data = await response.json();

    if (data.success) {
      batchMergeResult = data;
      mergeResult = null;
      renderBatchMergePreview(data);
      document.getElementById('merge-download-btn').disabled = false;
      showToast(`批量拼接完成，共 ${data.results.length} 组`, 'success');
    } else {
      showToast('批量拼接失败: ' + data.error, 'error');
    }
  } catch (err) {
    showToast('批量拼接失败: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

function renderSingleMergePreview(data) {
  const previewPanel = document.getElementById('merge-preview-panel');
  const previewInfo = document.getElementById('merge-preview-info');

  const grid = document.getElementById('merge-preview-grid');
  if (grid) grid.remove();

  const container = previewPanel.querySelector('.preview-container');
  container.innerHTML = '';
  const previewImg = document.createElement('img');
  previewImg.id = 'merge-preview-img';
  previewImg.alt = '拼接预览';
  previewImg.src = `${window.location.origin}/static/${data.outputId}.${data.format}`;
  previewImg.style.display = 'block';
  container.appendChild(previewImg);

  previewInfo.textContent = `${data.width} × ${data.height} 像素 · ${data.format.toUpperCase()}`;
  previewPanel.style.display = 'block';
}

function renderBatchMergePreview(data) {
  const previewPanel = document.getElementById('merge-preview-panel');
  const previewInfo = document.getElementById('merge-preview-info');
  
  previewInfo.textContent = `共 ${data.results.length} 组拼接结果`;
  previewPanel.style.display = 'block';
  
  const container = previewPanel.querySelector('.preview-container');
  container.innerHTML = '';
  
  const grid = document.createElement('div');
  grid.id = 'merge-preview-grid';
  grid.className = 'batch-preview-grid';
  
  data.results.forEach((result, index) => {
    const item = document.createElement('div');
    item.className = 'batch-preview-item';
    
    const img = document.createElement('img');
    img.src = `${window.location.origin}/static/${data.outputId}/${result.filename}`;
    img.alt = `第${index + 1}组`;
    
    const label = document.createElement('div');
    label.className = 'batch-preview-label';
    label.textContent = `第 ${index + 1} 组 (${result.width}×${result.height})`;
    
    item.appendChild(img);
    item.appendChild(label);
    grid.appendChild(item);
  });
  
  container.appendChild(grid);
}

function handleMergeDownload() {
  if (batchMergeResult) {
    const link = document.createElement('a');
    link.href = `${API_BASE}/download/${batchMergeResult.outputId}.zip`;
    link.download = batchMergeResult.zipName;
    link.click();
  } else if (mergeResult) {
    const link = document.createElement('a');
    link.href = `${API_BASE}/download/${mergeResult.outputId}.${mergeResult.format}`;
    link.download = mergeResult.filename;
    link.click();
  }
}

async function handleSplit() {
  if (!splitImage) {
    showToast('请先上传图片', 'error');
    return;
  }

  const rows = parseInt(document.getElementById('split-rows').value) || 2;
  const cols = parseInt(document.getElementById('split-cols').value) || 2;

  if (rows < 1 || cols < 1) {
    showToast('行列数必须大于0', 'error');
    return;
  }

  showLoading('正在分割图片...');

  try {
    const response = await fetch(`${API_BASE}/split`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-id': sessionId
      },
      body: JSON.stringify({
        image: {
          id: splitImage.id,
          name: splitImage.name,
          path: splitImage.path
        },
        rows: rows,
        cols: cols
      })
    });

    const data = await response.json();

    if (data.success) {
      splitResult = data;
      renderSplitResult(data);
      document.getElementById('split-download-btn').disabled = false;
      showToast(`分割完成，共 ${data.pieces.length} 张图片`, 'success');
    } else {
      showToast('分割失败: ' + data.error, 'error');
    }
  } catch (err) {
    showToast('分割失败: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

function renderSplitResult(data) {
  const previewPanel = document.getElementById('split-preview-panel');
  const grid = document.getElementById('split-grid');
  const previewInfo = document.getElementById('split-preview-info');

  previewInfo.textContent = `${data.originalWidth} × ${data.originalHeight} → ${data.rows}行 × ${data.cols}列`;
  
  grid.style.gridTemplateColumns = `repeat(${data.cols}, 1fr)`;
  grid.innerHTML = '';

  data.pieces.forEach((piece, index) => {
    const img = document.createElement('img');
    img.src = `${window.location.origin}/static/${data.outputId}/${piece.name}`;
    img.alt = piece.name;
    img.title = `${piece.name} (${piece.width}×${piece.height})`;
    img.addEventListener('click', () => {
      const link = document.createElement('a');
      link.href = `${window.location.origin}/static/${data.outputId}/${piece.name}`;
      link.download = piece.name;
      link.click();
    });
    grid.appendChild(img);
  });

  previewPanel.style.display = 'block';
}

function handleSplitDownload() {
  if (!splitResult) return;
  
  const link = document.createElement('a');
  link.href = `${API_BASE}/download/${splitResult.outputId}.zip`;
  link.download = splitResult.zipName;
  link.click();
}

async function checkServer() {
  try {
    const response = await fetch(`${API_BASE}/health`);
    const data = await response.json();
    if (data.status === 'ok') {
      console.log('服务器连接正常');
    }
  } catch (err) {
    showToast('无法连接到服务器，请确保后端服务已启动 (端口8720)', 'error');
  }
}

function init() {
  initTabs();
  initUploadAreas();
  initSettings();
  initActions();
  checkServer();
}

document.addEventListener('DOMContentLoaded', init);
