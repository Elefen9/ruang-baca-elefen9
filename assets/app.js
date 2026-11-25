
const API_URL = 'https://script.google.com/macros/s/AKfycbws5vVv1dw6yGSSN4uTh_9RHhZ8s0SLVaaLjdE4Y9s9bhfT-cyNIRsL1Ac2wktGbLvN/exec';

const DB_NAME = 'elefen9-library';
const DB_VERSION = 2;

let books = [];
let isOwner = false;
let ownerToken = localStorage.getItem('elefen9_owner_token') || '';
let deferredInstall = null;
let db;
let syncing = false;

const $ = id => document.getElementById(id);

function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;',
    '"': '&quot;', "'": '&#39;'
  })[c]);
}

// DATABASE LOKAL

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains('books')) {
        database.createObjectStore('books', { keyPath: 'id' });
      }

      if (!database.objectStoreNames.contains('outbox')) {
        database.createObjectStore('outbox', { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function storeRequest(storeName, mode, action) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    let request;

    try {
      request = action(store);
    } catch (error) {
      reject(error);
      return;
    }

    transaction.oncomplete = () => {
      resolve(request ? request.result : undefined);
    };

    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function getAll(storeName) {
  return storeRequest(storeName, 'readonly', store => store.getAll());
}

function getOne(storeName, id) {
  return storeRequest(storeName, 'readonly', store => store.get(id));
}

function putOne(storeName, value) {
  return storeRequest(storeName, 'readwrite', store => store.put(value));
}

function deleteOne(storeName, id) {
  return storeRequest(storeName, 'readwrite', store => store.delete(id));
}

async function saveLocalBook(book) {
  await putOne('books', book);
}

async function saveServerBooks(serverBooks) {
  const pending = await getAll('outbox');
  const pendingIds = new Set(pending.map(item => item.id));

  await storeRequest('books', 'readwrite', store => {
    store.clear();

    serverBooks.forEach(book => {
      if (!pendingIds.has(book.id)) {
        store.put(book);
      }
    });

    pending.forEach(item => {
      if (item.action !== 'delete' && item.book) {
        store.put(item.book);
      }
    });
  });
}

// ANTREAN SINKRONISASI

async function queueChange(action, book) {
  const id = String(book.id);
  const previous = await getOne('outbox', id);

  if (action === 'delete') {
    if (previous && previous.action === 'add') {
      await deleteOne('outbox', id);
      await deleteOne('books', id);
      return;
    }

    await putOne('outbox', {
      id,
      action: 'delete',
      book: { id }
    });

    await deleteOne('books', id);
    return;
  }

  let finalAction = action;

  if (previous && previous.action === 'add') {
    finalAction = 'add';
  }

  await saveLocalBook(book);

  await putOne('outbox', {
    id,
    action: finalAction,
    book
  });
}

async function apiPost(action, book = {}, token = ownerToken) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8'
    },
    body: JSON.stringify({ action, book: toServerBook(book), token })
  });

  const result = await response.json();

  if (!result.success) {
    throw new Error(result.message || 'Permintaan gagal.');
  }

  return result;
}

async function syncQueue() {
  if (syncing || !navigator.onLine || !ownerToken || !isOwner) {
    return;
  }

  syncing = true;

  try {
    const queue = await getAll('outbox');

    for (const item of queue) {
      if (item.action === 'delete') {
        await apiPost('delete', { id: item.id });
      } else {
        try {
          await apiPost(item.action, item.book);
        } catch (error) {
          if (
            item.action === 'edit' &&
            error.message.includes('Buku tidak ditemukan')
          ) {
            await apiPost('add', item.book);
          } else {
            throw error;
          }
        }
      }

      await deleteOne('outbox', item.id);
    }

    const result = await apiPost('list');

    const serverBooks = result.books.map(fromServerBook);

    await saveServerBooks(serverBooks);

    books = await getAll('books');

    render();

    $('notice').textContent = 'Semua perubahan berhasil disinkronkan.';
  } catch (error) {
    console.error('Sinkronisasi gagal:', error);
    $('notice').textContent =
      'Sinkronisasi tertunda: ' + error.message;
  } finally {
    syncing = false;
    updateConnection();
  }
}

// DATA DARI SERVER

async function loadPublicBooks() {
  const response = await fetch(API_URL);
  const result = await response.json();

  if (!Array.isArray(result)) {
    throw new Error(result.message || 'Katalog tidak dapat dibaca.');
  }

  const mapped = result.map(item => ({
    id: String(item.id),
    title: item.judul || '',
    author: item.penulis || '',
    isbn: item.isbn || '',
    publisher: item.penerbit || '',
    year: item.tahun || '',
    genre: item.tema || '',
    readingStatus: item.statusBaca || 'Belum dibaca',
    availability: item.statusKoleksi || 'Tersedia',
    cover: item.cover || '',
    published: true
  }));

  for (const book of mapped) {
    await saveLocalBook(book);
  }

  return mapped;
}

function formatDate(value) {
  if (!value) return '';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value).slice(0, 10);
  }

  return date.toISOString().slice(0, 10);
}

function fromServerBook(item) {
  return {
    id: String(item.ID),
    title: item.Judul || '',
    author: item.Penulis || '',
    isbn: item.ISBN || '',
    publisher: item.Penerbit || '',
    year: item.Tahun || '',
    genre: item.Tema || '',
    cover: item.Cover || '',
    readingStatus: item['Status Baca'] || 'Belum dibaca',
    availability: item['Status Koleksi'] || 'Tersedia',
    borrower: item.Peminjam || '',
    acquired: formatDate(item['Tanggal Perolehan']),
    source: item['Sumber Perolehan'] || '',
    giver: item.Pemberi || '',
    disposition: item.Keputusan || 'Disimpan',
    price: item.Harga || '',
    notes: item.Catatan || '',
    published: ['ya', 'true'].includes(
      String(item['Tampil Publik']).toLowerCase()
    )
  };
}

function toServerBook(book) {
  return {
    ID: book.id,
    Judul: book.title,
    Penulis: book.author,
    ISBN: book.isbn,
    Penerbit: book.publisher,
    Tahun: book.year,
    Tema: book.genre,
    Cover: book.cover || '',
    'Status Baca': book.readingStatus,
    'Status Koleksi': book.availability,
    Peminjam: book.borrower || '',
    'Tanggal Perolehan': book.acquired || '',
    'Sumber Perolehan': book.source || '',
    Pemberi: book.giver || '',
    Keputusan: book.disposition || 'Disimpan',
    Harga: book.price || '',
    Catatan: book.notes || '',
    'Tampil Publik': book.published ? 'Ya' : 'Tidak'
  };
}

// TAMPILAN KATALOG

function render() {
  const q = $('searchInput').value.toLowerCase();
  const status = $('statusFilter').value;

  const availableBooks = isOwner
    ? books
    : books.filter(book => book.published);

  const visible = availableBooks.filter(book =>
    (!status || book.readingStatus === status) &&
    [
      book.title, book.author, book.isbn,
      book.publisher, book.genre
    ].join(' ').toLowerCase().includes(q)
  );

  $('totalCount').textContent = availableBooks.length;

  $('readingCount').textContent =
    availableBooks.filter(b =>
      b.readingStatus === 'Sedang dibaca'
    ).length;

  $('finishedCount').textContent =
    availableBooks.filter(b =>
      b.readingStatus === 'Selesai'
    ).length;

  $('resultLabel').textContent =
    `Menampilkan ${visible.length} dari ${availableBooks.length} buku`;

  $('bookGrid').innerHTML = visible.map(book => `
    <article class="book-card">
      <div class="cover">
        ${book.cover
          ? `<img src="${escapeHTML(book.cover)}" alt="Sampul">`
          : '<span class="cover-placeholder">E9</span>'}
      </div>
      <div class="book-info">
        <h3>${escapeHTML(book.title)}</h3>
        <p>${escapeHTML(book.author || 'Penulis tidak dicatat')}</p>
        <span class="pill">${escapeHTML(book.readingStatus)}</span>
        ${isOwner ? `
          <div class="card-actions">
            <button class="button button-light"
              data-edit="${escapeHTML(book.id)}">Edit</button>
            <button class="button button-light"
              data-delete="${escapeHTML(book.id)}">Hapus</button>
          </div>` : ''}
      </div>
    </article>
  `).join('');

  $('emptyState').hidden = visible.length !== 0;
}

function setOwnerMode(value) {
  isOwner = value;
  $('addBtn').hidden = !value;
  $('loginBtn').hidden = value;
  $('logoutBtn').hidden = !value;
}

async function updateConnection() {
  const pending = db ? await getAll('outbox') : [];

  if (!navigator.onLine) {
    $('connectionState').textContent =
      `Offline · ${pending.length} perubahan menunggu`;
  } else if (pending.length) {
    $('connectionState').textContent =
      `Online · ${pending.length} perubahan menunggu`;
  } else {
    $('connectionState').textContent =
      'Online · tersambung';
  }
}

async function loadCatalog() {
  try {
    if (isOwner && ownerToken) {
      const result = await apiPost('list');
      const serverBooks = result.books.map(fromServerBook);

      await saveServerBooks(serverBooks);

      books = await getAll('books');

      $('notice').textContent = 'Data pengelola berhasil dimuat.';
    } else {
      if (navigator.onLine) {
        books = await loadPublicBooks();
        $('notice').textContent = 'Katalog publik berhasil dimuat.';
      } else {
        books = await getAll('books');
        $('notice').textContent = 'Menampilkan katalog tersimpan di perangkat.';
      }
    }
  } catch (error) {
    books = await getAll('books');

    $('notice').textContent =
      'Menggunakan data perangkat. ' + error.message;
  }

  render();
  await updateConnection();
}

// FORMULIR BUKU

function resetForm() {
  $('bookForm').reset();
  $('bookId').value = '';
  $('dialogTitle').textContent = 'Tambah buku';
  $('published').checked = true;
}

function openForm(book) {
  resetForm();

  if (book) {
    $('dialogTitle').textContent = 'Edit buku';
    $('bookId').value = book.id;

    const fields = {
      title: 'title',
      author: 'author',
      isbn: 'isbn',
      publisher: 'publisher',
      year: 'year',
      genre: 'genre',
      readingStatus: 'readingStatus',
      availability: 'availability',
      borrower: 'borrower',
      acquired: 'acquired',
      source: 'source',
      giver: 'giver',
      disposition: 'disposition',
      price: 'price',
      notes: 'notes'
    };

    for (const [key, id] of Object.entries(fields)) {
      $(id).value = book[key] ?? '';
    }

    $('published').checked = book.published !== false;
  }

  $('bookDialog').showModal();
}

// LOGIN

$('loginBtn').onclick = () => {
  $('loginMessage').textContent = '';
  $('ownerToken').value = '';
  $('loginDialog').showModal();
};

$('closeLogin').onclick = () => $('loginDialog').close();
$('cancelLogin').onclick = () => $('loginDialog').close();

$('loginForm').onsubmit = async event => {
  event.preventDefault();

  const token = $('ownerToken').value.trim();
  $('loginMessage').textContent = 'Memeriksa akses...';

  try {
    const result = await apiPost('list', {}, token);

    ownerToken = token;
    localStorage.setItem('elefen9_owner_token', token);

    setOwnerMode(true);

    await saveServerBooks(result.books.map(fromServerBook));
    books = await getAll('books');

    render();

    $('loginDialog').close();
    $('notice').textContent = 'Login pengelola berhasil.';

    await syncQueue();
    await updateConnection();
  } catch (error) {
    $('loginMessage').textContent =
      'Login gagal: ' + error.message;
  }
};

$('logoutBtn').onclick = async () => {
  if (!confirm('Keluar dari mode pengelola?')) return;

  localStorage.removeItem('elefen9_owner_token');

  ownerToken = '';
  setOwnerMode(false);

  await loadCatalog();
};

// TAMBAH, EDIT, DAN HAPUS

$('addBtn').onclick = () => openForm();

$('closeDialog').onclick = () => $('bookDialog').close();
$('cancelBtn').onclick = () => $('bookDialog').close();

$('searchInput').oninput = render;
$('statusFilter').onchange = render;

$('bookGrid').onclick = async event => {
  const edit = event.target.dataset.edit;
  const del = event.target.dataset.delete;

  if (edit) {
    const book = books.find(item => item.id === edit);
    if (book) openForm(book);
  }

  if (del && confirm('Hapus buku ini?')) {
    try {
      await queueChange('delete', { id: del });

      await updateConnection();
      render();

      if (navigator.onLine) {
        await syncQueue();
      } else {
        $('notice').textContent =
          'Penghapusan disimpan. Akan dikirim saat online.';
      }
    } catch (error) {
      alert('Gagal menghapus: ' + error.message);
    }
  }
};

$('bookForm').onsubmit = async event => {
  event.preventDefault();

  const id = $('bookId').value || crypto.randomUUID();
  const old = books.find(book => book.id === id);

  if ($('cover').files.length) {
    alert('Fitur unggah sampul belum diaktifkan. Simpan buku tanpa sampul dahulu.');
    return;
  }

  const book = {
    id,
    title: $('title').value.trim(),
    author: $('author').value.trim(),
    isbn: $('isbn').value.trim(),
    publisher: $('publisher').value.trim(),
    year: $('year').value,
    genre: $('genre').value,
    readingStatus: $('readingStatus').value,
    availability: $('availability').value,
    borrower: $('borrower').value,
    acquired: $('acquired').value,
    source: $('source').value,
    giver: $('giver').value,
    disposition: $('disposition').value,
    price: $('price').value,
    notes: $('notes').value,
    published: $('published').checked,
    cover: old ? old.cover || '' : ''
  };

  try {
    await queueChange(old ? 'edit' : 'add', book);

    $('bookDialog').close();

    books = await getAll('books');
    render();

    await updateConnection();

    if (navigator.onLine) {
      await syncQueue();
    } else {
      $('notice').textContent =
        'Buku tersimpan di perangkat. Akan disinkronkan saat online.';
    }
  } catch (error) {
    alert('Gagal menyimpan buku: ' + error.message);
  }
};

// KONEKSI DAN SINKRONISASI

window.addEventListener('online', async () => {
  updateConnection();

  if (isOwner) {
    await syncQueue();
  } else {
    await loadCatalog();
  }
});

window.addEventListener('offline', updateConnection);

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstall = event;
  $('installBtn').hidden = false;
});

$('installBtn').onclick = async () => {
  if (!deferredInstall) return;

  deferredInstall.prompt();
  await deferredInstall.userChoice;

  deferredInstall = null;
  $('installBtn').hidden = true;
};

// SAAT WEBSITE DIBUKA

(async function start() {
  try {
    db = await openDB();
  } catch (error) {
    $('notice').textContent =
      'Penyimpanan lokal tidak dapat dibuka: ' + error.message;
    return;
  }

  setOwnerMode(false);
  updateConnection();

  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./sw.js');
    } catch (error) {
      console.warn('Service worker belum aktif', error);
    }
  }

  if (ownerToken) {
    setOwnerMode(true);

    try {
      await loadCatalog();
      await syncQueue();
      return;
    } catch (error) {
      console.warn(error);
    }
  }

  setOwnerMode(false);
  await loadCatalog();
})();
