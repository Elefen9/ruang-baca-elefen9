
const API_URL = 'https://script.google.com/macros/s/AKfycbws5vVv1dw6yGSSN4uTh_9RHhZ8s0SLVaaLjdE4Y9s9bhfT-cyNIRsL1Ac2wktGbLvN/exec';

let books = [];
let isOwner = false;
let ownerToken = localStorage.getItem('elefen9_owner_token') || '';
let deferredInstall = null;

const $ = id => document.getElementById(id);

function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;',
    '"': '&quot;', "'": '&#39;'
  })[c]);
}

async function apiPost(action, book = {}, token = ownerToken) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8'
    },
    body: JSON.stringify({ action, book, token })
  });

  const result = await response.json();

  if (!result.success) {
    throw new Error(result.message || 'Permintaan gagal.');
  }

  return result;
}

async function loadPublicBooks() {
  const response = await fetch(API_URL);
  const result = await response.json();

  if (!Array.isArray(result)) {
    throw new Error(result.message || 'Katalog tidak dapat dibaca.');
  }

  return result.map(item => ({
    id: String(item.id),
    title: item.judul || '',
    author: item.penulis || '',
    isbn: item.isbn || '',
    publisher: item.penerbit || '',
    year: item.tahun || '',
    genre: item.tema || '',
    readingStatus: item.statusBaca || 'Belum dibaca',
    availability: item.statusKoleksi || 'Tersedia',
    cover: ''
  }));
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
    acquired: item['Tanggal Perolehan'] || '',
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
    Cover: '',
    'Status Baca': book.readingStatus,
    'Status Koleksi': book.availability,
    Peminjam: book.borrower,
    'Tanggal Perolehan': book.acquired,
    'Sumber Perolehan': book.source,
    Pemberi: book.giver,
    Keputusan: book.disposition,
    Harga: book.price,
    Catatan: book.notes,
    'Tampil Publik': book.published ? 'Ya' : 'Tidak'
  };
}

function render() {
  const q = $('searchInput').value.toLowerCase();
  const status = $('statusFilter').value;

  const visible = books.filter(book =>
    (!status || book.readingStatus === status) &&
    [book.title, book.author, book.isbn, book.publisher, book.genre]
      .join(' ').toLowerCase().includes(q)
  );

  $('totalCount').textContent = books.length;
  $('readingCount').textContent =
    books.filter(b => b.readingStatus === 'Sedang dibaca').length;
  $('finishedCount').textContent =
    books.filter(b => b.readingStatus === 'Selesai').length;

  $('resultLabel').textContent =
    `Menampilkan ${visible.length} dari ${books.length} buku`;

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
            <button class="button button-light" data-edit="${escapeHTML(book.id)}">Edit</button>
            <button class="button button-light" data-delete="${escapeHTML(book.id)}">Hapus</button>
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

async function loadCatalog() {
  $('notice').textContent = 'Mengambil katalog dari Google Sheets...';

  try {
    if (isOwner && ownerToken) {
      const result = await apiPost('list');
      books = result.books.map(fromServerBook);
      $('notice').textContent = 'Login pengelola aktif. Data lengkap berhasil dimuat.';
    } else {
      books = await loadPublicBooks();
      $('notice').textContent = 'Katalog publik berhasil dimuat.';
    }

    render();
    updateConnection();
  } catch (error) {
    $('notice').textContent = 'Koneksi gagal: ' + error.message;
    console.error(error);
  }
}

function updateConnection() {
  $('connectionState').textContent = navigator.onLine
    ? 'Online · terhubung ke katalog'
    : 'Offline · data cloud belum tersedia';
}

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
    books = result.books.map(fromServerBook);

    setOwnerMode(true);
    render();
    $('loginDialog').close();
    $('notice').textContent = 'Login pengelola berhasil.';
    updateConnection();
  } catch (error) {
    $('loginMessage').textContent =
      'Login gagal: ' + error.message;
  }
};

$('logoutBtn').onclick = () => {
  localStorage.removeItem('elefen9_owner_token');
  ownerToken = '';
  setOwnerMode(false);
  loadCatalog();
};

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

  if (del && confirm('Hapus buku ini dari Google Sheets?')) {
    try {
      await apiPost('delete', { ID: del });
      await loadCatalog();
      alert('Buku berhasil dihapus.');
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
    alert('Unggah sampul ke Google Drive belum diaktifkan. Silakan simpan data buku tanpa sampul dahulu.');
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
    published: $('published').checked
  };

  try {
    const action = old ? 'edit' : 'add';
    await apiPost(action, toServerBook(book));
    $('bookDialog').close();
    await loadCatalog();
    alert('Buku berhasil disimpan.');
  } catch (error) {
    alert('Gagal menyimpan: ' + error.message);
  }
};

window.addEventListener('online', () => {
  updateConnection();
  loadCatalog();
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

(async function start() {
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
    try {
      const result = await apiPost('list');
      books = result.books.map(fromServerBook);
      setOwnerMode(true);
      render();
      $('notice').textContent = 'Pengelola berhasil dikenali di perangkat ini.';
      return;
    } catch (error) {
      localStorage.removeItem('elefen9_owner_token');
      ownerToken = '';
      setOwnerMode(false);
    }
  }

  await loadCatalog();
})();
