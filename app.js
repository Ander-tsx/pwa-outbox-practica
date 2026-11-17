const API_URL = 'https://jsonplaceholder.typicode.com/posts';

const lista = document.getElementById('lista-outbox');
const formulario = document.getElementById('form-incidencia');
const botonPurgar = document.getElementById('btn-purgar');
const badgeRed = document.getElementById('badge-red');

// Registrar el service worker y escuchar sus mensajes
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then(() => console.log('Service worker registrado'))
    .catch((error) => console.log('No se pudo registrar el service worker', error));

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.tipo === 'OUTBOX_SINCRONIZADO') {
      console.log('[UI] Confirmación recibida del Service Worker. Actualizando bandeja...');
      renderizarColaOutbox();
    }
  });
}

// Indicador de red
function actualizarIndicadorRed(){
  if (navigator.onLine) {
    badgeRed.textContent = 'En Línea';
    badgeRed.className = 'badge online';
  } else {
    badgeRed.textContent = 'Sin Conexión';
    badgeRed.className = 'badge offline';
  }
}

// READ: dibuja la lista
function renderizarColaOutbox(){
  return obtenerTodosLosRegistros().then((registros) => {
    lista.innerHTML = '';

    registros.forEach((item) => {
      const li = document.createElement('li');
      const hora = new Date(item.fechaCreacion).toLocaleTimeString();
      li.textContent = item.titulo + ' - ' + item.estado + ' - ' + hora;
      lista.appendChild(li);
    });
  });
}

// CREATE
function procesarEnvioReporte(datosFormulario){
  return fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datosFormulario)
  })
    .then((respuesta) => {
      if (!respuesta.ok) throw new Error('Error HTTP del servidor');
      return respuesta.json();
    })
    .then(() => {
      return guardarRegistro({
        ...datosFormulario,
        estado: 'sincronizado',
        fechaCreacion: Date.now()
      });
    })
    .catch(() => {
      console.warn('[Outbox] Sin conexión. Encolando en IndexedDB...');

      return guardarRegistro({
        ...datosFormulario,
        estado: 'pendiente',
        fechaCreacion: Date.now()
      })
        .then(() => {
          if ('serviceWorker' in navigator && 'SyncManager' in window) {
            return navigator.serviceWorker.ready
              .then((registro) => {
                console.log('[Outbox] Registrando etiqueta sync-reportes en el SW...');
                return registro.sync.register('sync-reportes');
              });
          }
        });
    })
    .then(() => {
      return renderizarColaOutbox();
    });
}

// Formulario
formulario.addEventListener('submit', (e) => {
  e.preventDefault();

  const datos = {
    titulo: document.getElementById('titulo').value,
    descripcion: document.getElementById('descripcion').value
  };

  procesarEnvioReporte(datos).then(() => {
    formulario.reset();
  });
});

// UPDATE
function sincronizarPendientesFallback(){
  console.log('[Outbox] Conexión detectada. Buscando registros pendientes...');

  return obtenerTodosLosRegistros()
    .then((registros) => {
      const pendientes = registros.filter((item) => item.estado === 'pendiente');

      if (pendientes.length === 0) {
        console.log('[Outbox] No hay transacciones pendientes por sincronizar.');
        return;
      }

      const promesasDeEnvio = pendientes.map((item) => {
        return fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: item.titulo, body: item.descripcion })
        })
          .then((res) => {
            if (!res.ok) throw new Error('Falla al reintentar envío');
            return actualizarEstadoRegistro(item.id, 'sincronizado');
          });
      });

      return Promise.all(promesasDeEnvio);
    })
    .then(() => {
      return renderizarColaOutbox();
    })
    .catch((error) => {
      console.error('[Outbox] Error durante la sincronización masiva:', error);
    });
}

window.addEventListener('online', () => {
  actualizarIndicadorRed();

  if (!('SyncManager' in window)) {
    console.log('[Outbox] Navegador sin SyncManager. Ejecutando fallback por evento online...');
    sincronizarPendientesFallback();
  }
});

window.addEventListener('offline', actualizarIndicadorRed);

// DELETE: purgar los sincronizados
botonPurgar.addEventListener('click', () => {
  obtenerTodosLosRegistros()
    .then((registros) => {
      const sincronizados = registros.filter((item) => item.estado === 'sincronizado');
      const borrados = sincronizados.map((item) => eliminarRegistro(item.id));
      return Promise.all(borrados);
    })
    .then(() => {
      return renderizarColaOutbox();
    });
});

// Al cargar la página
actualizarIndicadorRed();
renderizarColaOutbox();
