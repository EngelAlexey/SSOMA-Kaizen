export class ManualIndex {
    constructor() {
        this.chapters = {
            'ATTENDANCE': `
[MANUAL: MÓDULO DE ASISTENCIAS]
1. CONCEPTOS BÁSICOS:
   - Las asistencias registran la presencia diaria.
   - Se integran con el contrato del colaborador para calcular horas extra.
2. CÓMO REGISTRAR UNA ASISTENCIA (WEB):
   - Ve a Recursos Humanos > Asistencias.
   - Botón "Nueva Asistencia".
   - Selecciona: Empleado, Fecha, Proyecto.
   - El sistema pre-carga el horario. Ajusta la hora real de entrada/salida.
   - Clic en Guardar.
3. CÓMO ELIMINAR/EDITAR:
   - Solo administradores pueden editar una asistencia cerrada.
   - Ve al listado, busca la fecha y usa el icono de lápiz.
`,
            'STAFF': `
[MANUAL: GESTIÓN DE PERSONAL]
1. ALTA DE COLABORADOR:
   - Ruta: Recursos Humanos > Personal > Nuevo Colaborador.
   - Pestaña General: Cédula, Nombre, Correo (Obligatorios).
   - Pestaña Laboral: Puesto, Departamento, Salario Base.
   - Estado inicial: Activo.
2. GESTIÓN DE DOCUMENTOS:
   - En el perfil del empleado, pestaña "Expediente", puedes subir contratos escaneados.
3. BAJA DE PERSONAL:
   - Entra al perfil > Editar > Cambiar estado a "Inactivo" > Definir fecha de salida.
`,
            'PROJECTS': `
[MANUAL: PROYECTOS]
1. CREACIÓN DE PROYECTOS:
   - Ruta: Configuración > Proyectos > Nuevo.
   - Define: Código (ej: PRJ-001), Nombre, Cliente y Ubicación.
   - Asignación: Puedes asignar una lista de empleados autorizados para marcar en este proyecto.
2. ESTADOS:
   - Activo: Visible para marcas.
   - Finalizado: No permite nuevas marcas, solo consulta histórica.
`,
            'SSOMA': `
[MANUAL: SSOMA - SEGURIDAD]
1. REPORTE DE ACTOS INSEGUROS:
   - Ruta: SSOMA > Hallazgos > Nuevo.
   - Clasificación: Elige "Acto" (Comportamiento humano) o "Condición" (Entorno).
   - Evidencia: Es obligatorio subir una foto desde la app móvil o web.
   - Nivel de Riesgo: Alto, Medio, Bajo.
2. ENTREGA DE EPP:
   - Ruta: SSOMA > EPP > Entregas.
   - Selecciona el empleado y los ítems (Casco, Guantes, Botas).
   - El sistema genera un PDF para firma digital.
`,
            'GENERAL': `
[MANUAL GENERAL KAIZEN]
Kaizen es una plataforma integral.
- Para soporte técnico contacta a soporte@kaizen.com.
- Para cambiar tu contraseña: Perfil (esquina superior) > Seguridad > Cambiar clave.
- La aplicación móvil está disponible para Android e iOS para marcas en campo.
`
        };
    }

    getManualContent(topic) {
        return this.chapters[topic] || this.chapters['GENERAL'];
    }
}

export const manualIndex = new ManualIndex();