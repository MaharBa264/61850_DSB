export const es = {
  userinfo: {
    loggedInAs: 'Sesión iniciada como {{name}}',
  },
  compas: {
    loading: 'Cargando...',
    comment: 'Comentario',
    newLabel: 'Agregar nueva etiqueta',
    notExists: '¡El proyecto ya no existe en CoMPAS!',
    noSclTypes: 'No se encontraron tipos en CoMPAS',
    noScls: 'No se encontraron proyectos en CoMPAS',
    sclFilter: 'Filtrar por:',
    noFilteredScls: 'No se encontraron proyectos que coincidan con los filtros',
    noSclVersions: 'No se encontraron versiones de este proyecto en CoMPAS',
    sclType: 'Tipo de SCL',
    error: {
      type: '¡No se pudo determinar el tipo a partir del nombre del documento!',
      server: 'Error de comunicación con el ecosistema CoMPAS',
      serverDetails: '{{type}}: {{message}}',
    },
    warning: {
      nsdoc: 'No se pudo cargar el archivo NSDoc',
      nsdocDetails: 'No se puede cargar {{url}}',
    },
    changeset: {
      major: 'Cambio mayor',
      minor: 'Cambio menor',
      patch: 'Cambio de parche',
    },
    import: {
      title: 'Importar desde API',
    },
    label: {
      selectLabels: 'Seleccionar etiquetas a mostrar',
    },
    open: {
      title: 'Abrir proyecto',
      localTitle: 'Local',
      selectFileButton: 'Abrir archivo...',
      compasTitle: 'CoMPAS',
      listSclTypes: 'Seleccionar tipo de proyecto',
      listScls: 'Seleccionar proyecto ({{ type }})',
      otherTypeButton: 'Otro tipo...',
    },
    save: {
      saveTitle: 'Guardar proyecto',
      saveAsTitle: 'Guardar como nuevo proyecto',
      saveAsVersionTitle: 'Guardar como nueva versión de un proyecto existente',
      localTitle: 'Local',
      saveFileButton: 'Guardar en archivo...',
      compasTitle: 'CoMPAS',
      labelsTitle: 'Etiquetas de CoMPAS',
      addSuccess: 'Proyecto agregado a CoMPAS.',
      updateSuccess: 'Proyecto actualizado en CoMPAS',
    },
    updateSubstation: {
      title: 'Actualizar subestación',
    },
    importIEDS: {
      title: 'Importar IEDs',
    },
    merge: {
      title: 'Fusionar proyecto',
    },
    autoAlignment: {
      title: 'Alinear automáticamente el unifilar de las subestaciones seleccionadas',
      button: 'Ejecutar',
      missing: 'No hay subestaciones',
      success: 'Se actualizaron las coordenadas X/Y de la(s) subestación(es)',
    },
    uploadVersion: {
      title: 'Subir nueva versión del proyecto a CoMPAS',
      selectButton: 'Seleccionar archivo...',
      filename: 'Nombre de archivo',
      updateSuccess: 'Proyecto subido a CoMPAS',
    },
    versions: {
      title: 'Versiones de CoMPAS',
      sclInfo: 'Proyecto actual - Nombre: {{name}}, Versión: {{version}}',
      addVersionButton: 'Agregar versión',
      confirmRestoreTitle: '¿Restaurar versión?',
      confirmRestore: '¿Está seguro de restaurar la versión {{version}}?',
      restoreVersionSuccess: 'Se restauró la versión {{version}} del proyecto',
      deleteProjectButton: 'Eliminar proyecto',
      confirmDeleteTitle: '¿Eliminar proyecto?',
      confirmDelete: '¿Está seguro de eliminar todas las versiones?',
      deleteSuccess: 'Se eliminó el proyecto de CoMPAS',
      confirmDeleteVersionTitle: '¿Eliminar versión?',
      confirmDeleteVersion: '¿Está seguro de eliminar la versión {{version}}?',
      deleteVersionSuccess:
        'Se eliminó la versión {{version}} del proyecto de CoMPAS',
      confirmButton: 'Confirmar',
      compareButton: 'Comparar versiones',
      selectTwoVersionsTitle: '¿Seleccionar dos versiones?',
      selectTwoVersionsMessage:
        'Seleccione como máximo dos versiones para compararlas entre sí. Actualmente seleccionadas: {{size}}.',
      compareCurrentButton: 'Comparar versión (actual)',
      selectOneVersionsTitle: '¿Seleccionar una versión?',
      selectOneVersionsMessage:
        'Seleccione como máximo una versión para comparar con el proyecto actual. Actualmente seleccionadas: {{size}}.',
    },
    scl: {
      wizardTitle: 'Editar SCL',
      filenameHelper:
        'Nombre de archivo que usa CoMPAS al guardar en un sistema de archivos',
      labelsTitle: 'Etiquetas de CoMPAS',
      updateAction: 'Se actualizó el elemento privado de CoMPAS del elemento SCL',
    },
    compare: {
      title: 'Comparar versión {{newVersion}} con la versión {{oldVersion}}',
      titleCurrent: 'Comparar el proyecto actual con la versión {{oldVersion}}',
      noDiff: 'No hay diferencias entre las versiones',
      attributes: 'Atributos de',
      children: 'Elementos hijos de',
    },
    settings: {
      title: 'Configuración de CoMPAS',
      sclDataServiceUrl: 'URL del servicio de datos SCL de CoMPAS',
      sclValidatorServiceUrl: 'URL del servicio validador SCL de CoMPAS',
      cimMappingServiceUrl: 'URL del servicio de mapeo CIM de CoMPAS',
      sclAutoAlignmentServiceUrl:
        'URL del servicio de alineación automática SCL de CoMPAS',
      useWebsockets: 'Usar Websockets',
    },
    exportIEDParams: {
      noIEDs: 'No se encontraron IEDs',
    },
    session: {
      headingExpiring: '¡Su sesión está por expirar!',
      explainExpiring:
        'Por inactividad ({{expiringSessionWarning}} minutos), su sesión con los sistemas CoMPAS está por expirar. <br>' +
        "Si desea continuar trabajando, presione el botón 'Continuar'. De lo contrario, la sesión expirará en {{timeTillExpire}} minutos.",
      continue: 'Continuar',
      headingExpired: '¡Su sesión expiró!',
      explainExpiredWithProject:
        'Por inactividad ({{expiredSessionMessage}} minutos), su sesión con los sistemas CoMPAS expiró. <br>' +
        'Para continuar trabajando debe recargar el navegador e iniciar sesión nuevamente, pero se perderán las modificaciones del proyecto. <br>' +
        "Para evitarlo, primero puede guardar el proyecto en su sistema de archivos local con el botón 'Guardar proyecto'. <br>" +
        "Luego de cargar el proyecto original desde CoMPAS, puede agregar este archivo como nueva versión desde la pestaña 'Versiones de CoMPAS'.",
      explainExpiredWithoutProject:
        'Por inactividad ({{expiredSessionMessage}} minutos), su sesión con los sistemas CoMPAS expiró. <br>' +
        'Para continuar trabajando debe recargar el navegador e iniciar sesión nuevamente.',
      saveProject: 'Guardar proyecto',
    },
    autogensubstation: {
      substationAmount: '¡Se encontraron {{amount}} subestación(es) a crear!',
      voltagelevelAmount: `¡Generando {{amount}} nivel(es) de tensión para la subestación {{substationname}}!`,
      bayAmount: `¡Generando {{amount}} campo(s) (Bay) para el nivel de tensión {{voltagelevelname}}!`,
      substationGen: `¡Se generó la subestación {{substationname}} con su contenido!`,
    },
    export104: {
      noSignalsFound: 'La exportación 104 no encontró señales',
      invalidSignalWarning: 'La exportación 104 encontró una señal inválida',
      errors: {
        tiOrIoaInvalid:
          'Falta ti o ioa, o ioa tiene menos de 4 dígitos, ti: "{{ ti }}", ioa: "{{ ioa }}"',
        unknownSignalType:
          'Tipo de señal desconocido para ti: "{{ ti }}", ioa: "{{ ioa }}"',
        noDoi: 'No se encontró DOI padre para la dirección con ioa: "{{ ioa }}"',
        noBay:
          'No se encontró el campo (Bay) "{{ bayName }}" para la dirección con ioa: "{{ ioa }}"',
        noVoltageLevel:
          'No se encontró el nivel de tensión padre del campo "{{ bayName }}" para ioa "{{ ioa }}"',
        noSubstation:
          'No se encontró la subestación padre del nivel de tensión "{{ voltageLevelName }}" para ioa "{{ ioa }}"',
      },
    },
  },
  locamation: {
    vmu: {
      ied: {
        title: 'Configurar VMUs Locamation',
        missing: 'No se encontraron IEDs Locamation con dispositivos lógicos',
        name: 'IED',
      },
      ldevice: {
        name: 'Dispositivo lógico',
      },
      ln: {
        title: 'Configurar VMUs Locamation (IED)',
        editTitle: 'Editar VMU',
        name: 'Nodo lógico',
      },
      version: 'Versión de VMU Locamation',
      identifier: 'Identificador',
      identifierHelper:
        'La dirección del sensor. Se compone de 3 números separados por puntos. El rango de cada número es 0-255.',
      sum: 'Suma',
      sumHelper:
        'El conjunto de tres números de canal cuya suma de corrientes o tensiones se calculará. Los números se separan por comas. Los valores del sensor de corriente van de 0 a 5; los del sensor de tensión, de 0 a 2.',
      channel: 'Canal',
      channelHelper:
        'El número de canal en el sensor. Los valores del sensor de corriente van de 0 a 5; los del sensor de tensión, de 0 a 2.',
      transformPrimary: 'TransformPrimary',
      transformPrimaryHelper:
        'El numerador de la relación del transformador de medida.',
      transformSecondary: 'TransformSecondary',
      transformSecondaryHelper:
        'El denominador de la relación del transformador de medida.',
      updateAction:
        'Se actualizaron los campos privados de Locamation del nodo lógico {{lnName}}',
    },
  },
};
