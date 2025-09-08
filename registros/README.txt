Esta carpeta guarda registros TXT con números de comprobante y usuario.
Formato: YYYY-MM-DD.txt con líneas:
[ISO_DATE] userId=<ID> username=<nombre> receipt=<numero>

Modo TXT habilitado:
- Configura STORAGE_MODE=txt
- Opcional: REGISTROS_DIR=/opt/render/project/src/registros (Render)
- El servidor expone /registros como estático para descargar.
	Ej: https://tu-app.onrender.com/registros/2025-09-07.txt

Nota:
- En Render, sin disco persistente, el contenido se perderá al redeploy/restart.
- Para persistencia real en Render, usa Persistent Disk o los modos Sheets/GitHub/Email.
