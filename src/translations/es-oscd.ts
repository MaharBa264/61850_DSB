/* Traducción al español de los textos del núcleo de OpenSCD (generada y revisada). */
export const esOscd = {
  "scl": {
    "id": "ID",
    "name": "Nombre",
    "desc": "Descripción",
    "ord": "Ordinal",
    "value": "Valor",
    "EnumVal": "Valor de enumeración",
    "EnumType": "Tipo de enumeración",
    "DA": "Atributo de datos",
    "DO": "Objeto de datos",
    "DAType": "Tipo de atributo de datos",
    "DOType": "Tipo de objeto de datos",
    "CDC": "Clase de datos común",
    "Report": "Reporte",
    "LN": "Nodo lógico",
    "bType": "Tipo básico",
    "type": "Tipo",
    "sAddr": "Dirección corta",
    "valKind": "Tipo de valor",
    "valImport": "Importar valor",
    "fc": "Restricción funcional",
    "LNodeType": "Tipo de nodo lógico",
    "lnClass": "Clase de nodo lógico",
    "accessControl": "Control de acceso",
    "transient": "Dato transitorio",
    "Val": "Valor por defecto",
    "dchg": "Disparo por cambio de dato",
    "qchg": "Disparo por cambio de calidad",
    "dupd": "Disparo por actualización de dato",
    "period": "Publicación periódica",
    "gi": "Interrogación general",
    "fixedOffs": "Offset fijo",
    "securityEnable": "Seguridad habilitada",
    "DataSet": "Conjunto de datos (DataSet)",
    "Communication": "Comunicación",
    "TrgOps": "Opciones de disparo",
    "OptFields": "Campos opcionales",
    "multicast": "SMV según IEC 61850 9-2",
    "smpMod": "Modo de muestreo",
    "smpRate": "Frecuencia de muestreo",
    "nofASDU": "Muestras por paquete",
    "seqNum": "Agregar número de secuencia",
    "timeStamp": "Agregar sello de tiempo",
    "dataSet": "Agregar referencia al DataSet",
    "reasonCode": "Agregar causa del disparo",
    "dataRef": "Agregar descripción de los datos transmitidos",
    "entryID": "Agregar ID de entrada",
    "configRef": "Agregar revisión de configuración",
    "bufOvfl": "Agregar información de desborde del buffer",
    "indexed": "Múltiples instancias posibles",
    "buffered": "Reporte con buffer",
    "maxReport": "Cantidad de instancias",
    "bufTime": "Tiempo mínimo entre dos reportes",
    "intgPd": "Tiempo entre dos reportes periódicos",
    "SmvOpts": "Información opcional",
    "refreshTime": "Agregar sello de tiempo al paquete SMV",
    "sampleRate": "Agregar frecuencia de muestreo al paquete SMV",
    "security": "Posible uso futuro, p. ej. firma digital",
    "synchSourceId": "Agregar ID de fuente de sincronismo al paquete SMV",
    "SampledValueControl": "Bloque de control de valores muestreados",
    "iedName": "IED referenciado",
    "ldInst": "Dispositivo lógico referenciado",
    "prefix": "Prefijo del nodo lógico",
    "lnInst": "Instancia del nodo lógico",
    "virtual": "Virtual",
    "phase": "Fase"
  },
  "settings": {
    "title": "Configuración",
    "language": "Idioma",
    "languages": {
      "de": "Alemán (Deutsch)",
      "en": "Inglés (English)",
      "es": "Español"
    },
    "theme": "Tema",
    "themes": {
      "system": "Predeterminado del sistema",
      "light": "Claro",
      "dark": "Oscuro"
    },
    "mode": "Modo profesional",
    "showieds": "Mostrar IEDs en el editor de subestación",
    "selectFileButton": "Seleccionar archivo",
    "loadNsdTranslations": "Archivos NSDoc cargados",
    "invalidFileNoIdFound": "NSDoc inválido ({{ filename }}): no se encontró el atributo 'id' en el archivo",
    "invalidNsdocVersion": "La versión del NSD {{ id }} ({{ nsdVersion }}) no coincide con la del NSDoc correspondiente ({{ filename }}, {{ nsdocVersion }})"
  },
  "menu": {
    "new": "Nuevo proyecto",
    "title": "Menú",
    "viewLog": "Ver registro",
    "viewDiag": "Ver diagnóstico"
  },
  "wizard": {
    "title": {
      "select": "Seleccionar {{tagName}}",
      "edit": "Editar {{tagName}}",
      "add": "Agregar {{tagName}}",
      "selectAp": "Seleccionar nuevo ConnectedAP"
    }
  },
  "openSCD": {
    "loading": "Cargando proyecto {{ name }}",
    "loaded": "{{ name }} cargado",
    "readError": "Error al leer {{ name }}",
    "readAbort": "Lectura de {{ name }} cancelada"
  },
  "zeroline": {
    "iedsloading": "Cargando IEDs...",
    "showieds": "Mostrar/ocultar IEDs en el editor de subestación",
    "showfunctions": "Filtrar elementos de tipo función",
    "commmap": "Mapeo de comunicación",
    "reportcontrol": "Mostrar todos los reportes",
    "gsecontrol": "Mostrar todos los GOOSE",
    "smvcontrol": "Mostrar todos los valores muestreados"
  },
  "editing": {
    "node": "Objeto definido por el usuario",
    "created": "Se agregó {{ name }}",
    "deleted": "Se eliminó {{ name }}",
    "moved": "Se movió {{ name }}",
    "updated": "Se editó {{ name }}",
    "import": "Se importó {{name}}",
    "complex": "Se editaron varios elementos",
    "error": {
      "create": "No se pudo agregar {{ name }}",
      "update": "No se pudo editar {{ name }}",
      "move": "No se pudo mover {{ name }}",
      "duplicate": "No se pudo copiar {{ name }}",
      "nameClash": "El elemento padre {{ parent }} ya contiene un {{ child }} llamado \"{{ name }}\"",
      "idClash": "El proyecto ya tiene un ID \"{{ id }}\""
    }
  },
  "textfield": {
    "required": "Obligatorio",
    "nonempty": "No puede estar vacío",
    "noMultiplier": "ninguno",
    "unique": "Debe ser único"
  },
  "compare": {
    "compareButton": "Comparar",
    "attributes": "Atributos de {{ elementName }}",
    "children": "Elementos hijos de {{ elementName }}",
    "filterMutables": "Filtrar diferencias propias del proyecto"
  },
  "log": {
    "name": "Registro",
    "placeholder": "Aquí aparecerán los errores, advertencias y otras notificaciones.",
    "snackbar": {
      "show": "Mostrar",
      "placeholder": "Sin errores"
    }
  },
  "history": {
    "name": "Historial SCL",
    "placeholder": "Aquí aparecerán las ediciones",
    "noEntries": "No hay entradas en el historial SCL"
  },
  "diag": {
    "name": "Diagnóstico",
    "zeroissues": "No se encontraron errores en el proyecto",
    "placeholder": "Aquí aparecerán los problemas encontrados durante la validación",
    "missingnsd": "No se pueden validar las DataTypeTemplates. La versión del proyecto debe ser 2007B4 o superior",
    "lastValidated": "Validado a las {{ time }}"
  },
  "plugins": {
    "heading": "Plugins",
    "editor": "Pestaña de editor",
    "menu": "Entrada de menú",
    "requireDoc": "Requiere un documento cargado",
    "top": "arriba",
    "middle": "medio",
    "bottom": "abajo",
    "validator": "Validador",
    "add": {
      "heading": "Agregar plugin personalizado",
      "warning": "Aquí puede agregar plugins remotos directamente desde una URL personalizada. Lo hace bajo su propio riesgo.",
      "name": "Nombre",
      "nameHelper": "Nombre que prefiera para el plugin",
      "src": "URL",
      "srcHelper": "La URL del plugin provista por el proveedor"
    }
  },
  "validator": {
    "schema": {
      "title": "Validar proyecto",
      "valid": "Validación del esquema XML de {{ name }} exitosa",
      "invalid": "Falló la validación del esquema XML de {{ name }}",
      "fatal": "Error fatal de validación",
      "loadError": "No se pudo cargar el esquema XML {{ name }}"
    },
    "templates": {
      "title": "Validar plantillas",
      "mandatoryChild": "A {{ tag }} {{ id }} le falta el hijo obligatorio {{ childTag }} {{ childId }}",
      "missingAttribute": "El atributo {{attr}} es obligatorio pero falta en {{element}}",
      "incorrectAttribute": "El atributo {{attr}} es incorrecto en el elemento {{element}}.",
      "missingReference": "{{tag}}:{{name}} tiene una referencia inválida: el atributo type no puede vincularse a una plantilla"
    }
  },
  "substation": {
    "name": "Subestación",
    "missing": "Sin subestación",
    "wizard": {
      "nameHelper": "Nombre de la subestación",
      "descHelper": "Descripción de la subestación",
      "title": {
        "add": "Agregar subestación",
        "edit": "Editar subestación"
      }
    },
    "action": {
      "addvoltagelevel": "Agregar nivel de tensión",
      "updatesubstation": "Se editó la subestación \"{{name}}\""
    },
    "clone": {
      "redirect": "Redirigir LNode",
      "cloneclose": "Clonar una vez",
      "cloneproc": "Clonar varias veces",
      "newname": "Nombre del clon"
    }
  },
  "iededitor": {
    "iedSelector": "Seleccionar IED",
    "lnFilter": "Filtro de nodos lógicos",
    "missing": "Sin IED",
    "toggleChildElements": "Mostrar/ocultar elementos hijos",
    "settings": "Mostrar los servicios que provee el IED/AccessPoint",
    "createIed": "Crear IED virtual",
    "addAccessPoint": "Agregar AccessPoint",
    "wizard": {
      "daTitle": "Ver información del DA",
      "doTitle": "Ver información del DO",
      "nsdocDescription": "Descripción NSDoc",
      "doiDescription": "Descripción del objeto de datos",
      "daiDescription": "Descripción del atributo de datos",
      "ied": "IED",
      "accessPoint": "Punto de acceso",
      "lDevice": "Dispositivo lógico",
      "lnPrefix": "Prefijo del nodo lógico",
      "lnDescription": "Descripción del nodo lógico",
      "lnInst": "Instancia del nodo lógico",
      "doName": "Nombre del objeto de datos",
      "doCdc": "Clase de datos común del objeto de datos",
      "daName": "Nombre del atributo de datos",
      "daFc": "Restricción funcional del atributo de datos",
      "daBType": "Tipo del atributo de datos",
      "daValue": "Valor del atributo de datos"
    },
    "createDialog": {
      "iedName": "Nombre del IED",
      "nameFormatError": "El nombre del IED no puede contener espacios",
      "nameUniqueError": "Ya existe un IED con ese nombre"
    },
    "addAccessPointDialog": {
      "title": "Agregar AccessPoint",
      "nameHelper": "Nombre del AccessPoint",
      "descHelper": "Descripción del AccessPoint",
      "apName": "Nombre del AccessPoint",
      "createServerAt": "Agregar ServerAt",
      "selectAccessPoint": "Seleccionar AccessPoint",
      "serverAtDesc": "Descripción del ServerAt",
      "nameFormatError": "El nombre del AccessPoint no puede contener espacios",
      "nameUniqueError": "Ya existe un AccessPoint con ese nombre",
      "nameTooLongError": "El nombre del AccessPoint es demasiado largo"
    },
    "addLDeviceDialog": {
      "title": "Agregar LDevice",
      "inst": "Inst del LDevice",
      "desc": "Descripción del LDevice",
      "instRequiredError": "El inst del LDevice es obligatorio",
      "instFormatError": "Inst inválido",
      "instUniqueError": "Ya existe un LDevice con ese inst",
      "instTooLongError": "El inst del LDevice es demasiado largo"
    },
    "addLnDialog": {
      "title": "Agregar LN",
      "amount": "Cantidad",
      "prefix": "Prefijo",
      "filter": "Filtrar tipos de nodo lógico",
      "noResults": "No se encontraron tipos de nodo lógico"
    }
  },
  "accesspoint": {
    "wizard": {
      "nameHelper": "Nombre del AccessPoint",
      "descHelper": "Descripción del AccessPoint",
      "title": {
        "add": "Agregar AccessPoint",
        "edit": "Editar AccessPoint",
        "delete": "Eliminar AccessPoint con sus referencias",
        "references": "Referencias que se eliminarán"
      }
    }
  },
  "ied": {
    "wizard": {
      "nameHelper": "Nombre del IED",
      "descHelper": "Descripción del IED",
      "manufacturerHelper": "Fabricante del IED",
      "title": {
        "edit": "Editar IED",
        "delete": "Eliminar IED con sus referencias",
        "references": "Referencias que se eliminarán"
      }
    },
    "action": {
      "updateied": "Se editó el IED \"{{name}}\"",
      "deleteied": "Se eliminó el IED \"{{name}}\""
    }
  },
  "ldevice": {
    "wizard": {
      "nameHelper": "Nombre del dispositivo lógico",
      "noNameSupportHelper": "El IED no admite nombres funcionales (Functional Naming)",
      "descHelper": "Descripción del dispositivo lógico",
      "instHelper": "Inst del dispositivo lógico",
      "title": {
        "edit": "Editar dispositivo lógico"
      }
    }
  },
  "ln": {
    "wizard": {
      "title": {
        "edit": "Editar LN"
      },
      "descHelper": "Descripción del nodo lógico",
      "lnTypeHelper": "Tipo de nodo lógico",
      "prefixHelper": "Prefijo del nodo lógico",
      "lnClassHelper": "Clase del nodo lógico",
      "instHelper": "Instancia"
    }
  },
  "ln0": {
    "wizard": {
      "title": {
        "edit": "Editar LN0"
      },
      "descHelper": "Descripción del nodo lógico",
      "lnTypeHelper": "Tipo de nodo lógico",
      "lnClassHelper": "Clase del nodo lógico",
      "instHelper": "Instancia"
    }
  },
  "powertransformer": {
    "wizard": {
      "nameHelper": "Nombre del transformador de potencia",
      "descHelper": "Descripción del transformador de potencia",
      "typeHelper": "Tipo de transformador de potencia",
      "title": {
        "add": "Agregar transformador de potencia",
        "edit": "Editar transformador de potencia"
      }
    }
  },
  "voltagelevel": {
    "name": "Nivel de tensión",
    "wizard": {
      "nameHelper": "Nombre del nivel de tensión",
      "descHelper": "Descripción del nivel de tensión",
      "nomFreqHelper": "Frecuencia nominal",
      "numPhaseHelper": "Cantidad de fases",
      "voltageHelper": "Tensión nominal",
      "title": {
        "add": "Agregar nivel de tensión",
        "edit": "Editar nivel de tensión"
      }
    },
    "action": {
      "updateVoltagelevel": "Se editó el nivel de tensión \"{{name}}\""
    }
  },
  "line": {
    "name": "Línea",
    "wizard": {
      "nameHelper": "Nombre de la línea",
      "descHelper": "Descripción de la línea",
      "typeHelper": "Tipo de línea",
      "title": {
        "add": "Agregar línea",
        "edit": "Editar línea"
      }
    },
    "action": {
      "updateLine": "Se editó la línea \"{{name}}\""
    }
  },
  "process": {
    "name": "Proceso",
    "wizard": {
      "nameHelper": "Nombre del proceso",
      "descHelper": "Descripción del proceso",
      "typeHelper": "Tipo de proceso",
      "title": {
        "add": "Agregar proceso",
        "edit": "Editar proceso"
      }
    },
    "action": {
      "updateProcess": "Se editó el proceso \"{{name}}\""
    }
  },
  "bay": {
    "name": "Campo (Bay)",
    "wizard": {
      "nameHelper": "Nombre del campo",
      "descHelper": "Descripción del campo",
      "title": {
        "add": "Agregar campo",
        "edit": "Editar campo"
      }
    },
    "action": {
      "updateBay": "Se editó el campo \"{{name}}\""
    }
  },
  "conductingequipment": {
    "name": "Equipo conductor",
    "wizard": {
      "nameHelper": "Nombre del equipo conductor",
      "descHelper": "Descripción del equipo conductor",
      "typeHelper": "Tipo de equipo conductor",
      "title": {
        "add": "Agregar equipo conductor",
        "edit": "Editar equipo conductor"
      }
    },
    "unknownType": "Tipo desconocido"
  },
  "connectivitynode": {
    "name": "Nodo de conectividad",
    "wizard": {
      "nameHelper": "Nombre del nodo de conectividad",
      "pathNameHelper": "Ruta (pathname) del nodo de conectividad",
      "title": {
        "add": "Agregar nodo de conectividad",
        "edit": "Editar nodo de conectividad"
      }
    }
  },
  "terminal": {
    "name": "Terminal",
    "wizard": {
      "nameHelper": "Nombre del terminal",
      "connectivityNodeHelper": "Nodo de conectividad del terminal",
      "cNodeNameHelper": "Nombre del nodo de conectividad del terminal",
      "title": {
        "add": "Agregar terminal",
        "edit": "Editar terminal"
      }
    }
  },
  "templates": {
    "name": "Plantillas de tipos de datos",
    "missing": "Faltan las DataTypeTemplates",
    "add": "Agregar DataTypeTemplates"
  },
  "subscription": {
    "none": "Ninguno",
    "connect": "Conectar atributo de datos",
    "disconnect": "Desconectar atributo de datos",
    "subscriber": {
      "subscribed": "Suscripto",
      "notSubscribed": "No suscripto",
      "availableToSubscribe": "Disponible para suscribir",
      "partiallySubscribed": "Parcialmente suscripto",
      "noControlBlockSelected": "Ningún bloque de control seleccionado",
      "noIedSelected": "Ningún IED seleccionado"
    },
    "goose": {
      "publisher": {
        "title": "Publicadores GOOSE",
        "subscriberTitle": "IEDs suscriptos a {{ selected }}"
      },
      "subscriber": {
        "iedListTitle": "Suscriptores GOOSE",
        "publisherTitle": "Mensajes GOOSE a los que está suscripto {{selected}}"
      },
      "view": {
        "publisherView": "Publicador | Suscriptor",
        "subscriberView": "Suscriptor | Publicador"
      }
    },
    "smv": {
      "publisher": {
        "title": "Mensajes de valores muestreados",
        "subscriberTitle": "IEDs suscriptos a {{ selected }}"
      },
      "subscriber": {
        "iedListTitle": "Suscriptores de valores muestreados",
        "publisherTitle": "Mensajes de valores muestreados a los que está suscripto {{ selected }}"
      },
      "view": {
        "publisherView": "Publicador | Suscriptor",
        "subscriberView": "Suscriptor | Publicador"
      }
    },
    "binding": {
      "extRefList": {
        "title": "Nodos lógicos disponibles para el atributo de datos seleccionado",
        "noSelection": "Ningún atributo de datos seleccionado",
        "noSubscribedLNs": "No hay nodos lógicos suscriptos",
        "noAvailableLNs": "No hay nodos lógicos disponibles para suscribir"
      }
    },
    "laterBinding": {
      "extRefList": {
        "title": "Entradas disponibles para el atributo de datos seleccionado",
        "noSelection": "Ningún atributo de datos seleccionado",
        "noSubscribedExtRefs": "No hay entradas suscriptas",
        "noAvailableExtRefs": "No hay entradas disponibles para suscribir"
      }
    },
    "SampledValueControl": {
      "controlBlockList": {
        "title": "Mensajes de valores muestreados",
        "noControlBlockFound": "No se encontraron mensajes de valores muestreados"
      }
    },
    "GSEControl": {
      "controlBlockList": {
        "title": "Mensajes GOOSE",
        "noControlBlockFound": "No se encontraron mensajes GOOSE"
      }
    }
  },
  "protocol104": {
    "toggleChildElements": "Mostrar/ocultar elementos hijos",
    "view": {
      "valuesView": "Valores",
      "networkView": "Red"
    },
    "mappedCmv": "Según la norma IEC 61850-80-1, el mapeo de \"{{ cdc }}\" se requiere mediante CMV",
    "values": {
      "missing": "No hay IEDs con direcciones 104",
      "removeAddresses": "Eliminar todas las direcciones",
      "removedAddresses": "Se eliminaron direcciones del DOI \"{{ name }}\" ({{ nrOfAddresses }})",
      "addedAddress": "Se agregaron direcciones 104 al DO \"{{ name }}\" en el LN(0) \"{{ lnName }}\"",
      "signalNames": {
        "tiNumber1": "Información de punto simple",
        "tiNumber3": "Información de doble punto",
        "tiNumber5": "Información de posición de paso",
        "tiNumber7": "Cadena de bits de 32 bits",
        "tiNumber9": "Valor medido, valor normalizado",
        "tiNumber11": "Valor medido, valor escalado",
        "tiNumber13": "Valor medido, número en coma flotante corto",
        "tiNumber15": "Totales integrados",
        "tiNumber20": "Información de punto simple empaquetada con detección de cambio de estado",
        "tiNumber21": "Valor medido, valor normalizado sin descriptor de calidad",
        "tiNumber30": "Información de punto simple con etiqueta de tiempo CP56Time2a",
        "tiNumber31": "Información de doble punto con etiqueta de tiempo CP56Time2a",
        "tiNumber32": "Información de posición de paso con etiqueta de tiempo CP56Time2a",
        "tiNumber33": "Cadena de bits de 32 bits con etiqueta de tiempo CP56Time2a",
        "tiNumber34": "Valor medido, valor normalizado con etiqueta de tiempo CP56Time2a",
        "tiNumber35": "Valor medido, valor escalado con etiqueta de tiempo CP56Time2a",
        "tiNumber36": "Valor medido, número en coma flotante corto con etiqueta de tiempo CP56Time2a",
        "tiNumber37": "Totales integrados con etiqueta de tiempo CP56Time2a",
        "tiNumber38": "Evento de equipo de protección con etiqueta de tiempo CP56Time2a",
        "tiNumber39": "Eventos de arranque empaquetados de equipo de protección con etiqueta de tiempo CP56Time2a",
        "tiNumber40": "Información de circuito de salida empaquetada de equipo de protección con etiqueta de tiempo CP56Time2a",
        "tiNumber45": "Comando simple",
        "tiNumber46": "Comando doble",
        "tiNumber47": "Comando de paso regulador",
        "tiNumber48": "Comando de consigna, valor normalizado",
        "tiNumber49": "Comando de consigna, valor escalado",
        "tiNumber50": "Comando de consigna, número en coma flotante corto",
        "tiNumber51": "Comando de cadena de bits de 32 bits",
        "tiNumber58": "Comando simple con etiqueta de tiempo CP56Time2a",
        "tiNumber59": "Comando doble con etiqueta de tiempo CP56Time2a",
        "tiNumber60": "Comando de paso regulador con etiqueta de tiempo CP56Time2a",
        "tiNumber61": "Comando de valor medido, valor normalizado con etiqueta de tiempo CP56Time2a",
        "tiNumber62": "Comando de valor medido, valor escalado con etiqueta de tiempo CP56Time2a",
        "tiNumber63": "Comando de valor medido, número en coma flotante corto con etiqueta de tiempo CP56Time2a",
        "tiNumber64": "Comando de cadena de bits de 32 bits con etiqueta de tiempo CP56Time2a",
        "default": "Sin descripción disponible"
      }
    },
    "network": {
      "connectedAp": {
        "wizard": {
          "title": {
            "edit": "Editar ConnectedAP"
          },
          "redundancySwitchLabel": "Redundancia",
          "redundancyGroupTitle": "Grupos de redundancia",
          "noRedundancyGroupsAvailable": "No hay grupos de redundancia disponibles",
          "addRedundancyGroup": "Grupo de redundancia",
          "stationTypeHelper": "Tipo de estación",
          "ipHelper": "Dirección IP del enlace lógico",
          "ipSubnetHelper": "Máscara de subred de la dirección IP del enlace lógico",
          "wFactorHelper": "Factor W del enlace lógico",
          "kFactorHelper": "Factor K del enlace lógico",
          "timeout0Helper": "Timeout en segundos para el establecimiento de la conexión",
          "timeout1Helper": "Timeout en segundos de APDUs enviadas o de prueba",
          "timeout2Helper": "Timeout en segundos para acuses de recibo cuando no hay mensajes de datos",
          "timeout3Helper": "Timeout en segundos para enviar tramas de prueba tras un período prolongado de inactividad"
        }
      },
      "redundancyGroup": {
        "wizard": {
          "title": {
            "edit": "Editar grupo de redundancia",
            "add": "Agregar grupo de redundancia"
          },
          "redundancyGroupNumberLabel": "Número de grupo de redundancia",
          "addedLRedundancyGroup": "Se agregó el grupo de redundancia {{ rGNumber }} en la SubNetwork (name=\"{{ subNetworkName }}\") y el ConnectedAP (AccessPoint Name=\"{{ apName }}\", IED Name=\"{{ iedName }}\")",
          "editedRedundancyGroup": "Se editó el grupo de redundancia {{ rGNumber }} en la SubNetwork (name=\"{{ subNetworkName }}\") y el ConnectedAP (AccessPoint Name=\"{{ apName }}\", IED Name=\"{{ iedName }}\")",
          "removedRedundancyGroup": "Se eliminó el grupo de redundancia {{ rGNumber }} de la SubNetwork (name=\"{{ subNetworkName }}\") y el ConnectedAP (AccessPoint Name=\"{{ apName }}\", IED Name=\"{{ iedName }}\")",
          "logicLinkGroupTitle": "Enlaces lógicos",
          "noLogicLinksAvailable": "No hay enlaces lógicos disponibles",
          "addLogicLink": "Enlace lógico"
        }
      },
      "logicLink": {
        "wizard": {
          "title": {
            "edit": "Editar enlace lógico",
            "add": "Agregar enlace lógico"
          },
          "logicLinkNumberLabel": "Número de enlace lógico",
          "addedLogicLink": "Se agregó un grupo de enlaces lógicos a la SubNetwork (name=\"{{ subNetworkName }}\") y el ConnectedAP (AccessPoint Name=\"{{ apName }}\", IED Name=\"{{ iedName }}\")",
          "editedLogicLink": "Se editó el grupo de enlaces lógicos de la SubNetwork (name=\"{{ subNetworkName }}\") y el ConnectedAP (AccessPoint Name=\"{{ apName }}\", IED Name=\"{{ iedName }}\")",
          "removedLogicLink": "Se eliminó el grupo de enlaces lógicos de la SubNetwork (name=\"{{ subNetworkName }}\") y el ConnectedAP (AccessPoint Name=\"{{ apName }}\", IED Name=\"{{ iedName }}\")"
        }
      }
    },
    "wizard": {
      "title": {
        "doiInfo": "Información del DOI",
        "addressEdit": "Editar dirección 104",
        "addAddress": "Agregar dirección 104"
      },
      "error": {
        "ioaConflict": "Se encontró un conflicto de IOA dentro del número CASDU",
        "addAddressError": "Estructura de plantilla inválida, no se pudo crear el elemento DAI. (DO: \"{{ doType }}\", CDC: \"{{ cdc }}\", DAI: \"{{ structure }}\")"
      },
      "casduHelper": "Valor de CASDU",
      "ioaHelper": "Valor de IOA",
      "monitorTiHelper": "Valor de TI de monitoreo",
      "monitorInverted": "Crear direcciones invertidas (monitoreo)",
      "monitorCheck": "Crear direcciones de verificación (monitoreo)",
      "controlTiHelper": "Valor de TI de control",
      "controlInverted": "Crear direcciones invertidas (control)",
      "controlCheck": "Crear direcciones de verificación (control)",
      "expectedValueHelper": "Valor esperado",
      "unitMultiplierHelper": "Multiplicador de unidad",
      "scaleMultiplierHelper": "Multiplicador de escala",
      "scaleOffsetHelper": "Offset de escala"
    }
  },
  "compare-ied": {
    "selectProjectTitle": "Seleccionar el proyecto plantilla con el cual comparar el IED",
    "selectIedTitle": "Seleccionar IED para comparar",
    "resultTitle": "Comparación del IED con el IED del proyecto plantilla",
    "projectIedTitle": "IEDs del proyecto",
    "templateIedTitle": "IEDs del proyecto plantilla",
    "selectIedButton": "Seleccionar IED",
    "selectTemplateButton": "Seleccionar proyecto plantilla",
    "noDiff": "No hay diferencias entre el IED del proyecto \"{{ projectIedName }}\" y el IED plantilla \"{{ templateIedName }}\""
  },
  "enum-val": {
    "wizard": {
      "title": {
        "add": "Agregar EnumVal",
        "edit": "Editar EnumVal"
      }
    }
  },
  "enum": {
    "wizard": {
      "title": {
        "add": "Agregar EnumType",
        "edit": "Editar EnumType"
      }
    },
    "action": {
      "edit": "Cambiar el ID del EnumType \"{{oldId}}\" y sus referencias DA a {{newId}}"
    }
  },
  "datype": {
    "wizard": {
      "title": {
        "add": "Agregar DAType",
        "edit": "Editar DAType"
      }
    },
    "action": {
      "edit": "Cambiar el ID del DAType \"{{oldId}}\" y sus referencias DA a {{newId}}"
    }
  },
  "bda": {
    "wizard": {
      "title": {
        "add": "Agregar BDA",
        "edit": "Editar BDA"
      }
    }
  },
  "da": {
    "wizard": {
      "title": {
        "add": "Agregar DA",
        "edit": "Editar DA"
      }
    }
  },
  "dai": {
    "wizard": {
      "valueHelper": "El valor debe ser de tipo {{type}}",
      "title": {
        "create": "Crear DAI \"{{daiName}}\"",
        "edit": "Editar DAI \"{{daiName}}\""
      }
    },
    "action": {
      "createdai": "Se creó el DAI \"{{daiName}}\"",
      "updatedai": "Se editó el DAI \"{{daiName}}\""
    }
  },
  "sdo": {
    "wizard": {
      "title": {
        "add": "Agregar SDO",
        "edit": "Editar SDO"
      }
    }
  },
  "do": {
    "wizard": {
      "title": {
        "add": "Agregar DO",
        "edit": "Editar DO"
      }
    }
  },
  "dotype": {
    "wizard": {
      "title": {
        "add": "Agregar DOType",
        "edit": "Editar DOType"
      },
      "enums": "Enumeraciones por defecto"
    },
    "action": {
      "edit": "Cambiar el ID del DOType \"{{oldId}}\" y sus referencias DO a {{newId}}"
    }
  },
  "lnodetype": {
    "wizard": {
      "title": {
        "add": "Agregar LNodeType",
        "edit": "Editar LNodeType",
        "select": "Seleccionar objetos de datos"
      }
    },
    "action": {
      "edit": "Cambiar el ID del LNodeType \"{{oldId}}\" y sus referencias LN a {{newId}}"
    },
    "autoimport": "Usar la clase LN de la plantilla de OpenSCD",
    "missinglnclass": "Falta la clase LN predefinida"
  },
  "lnode": {
    "wizard": {
      "title": {
        "selectIEDs": "Seleccionar IEDs",
        "selectLDs": "Seleccionar dispositivos lógicos",
        "selectLNs": "Seleccionar nodos lógicos",
        "selectLNodeTypes": "Seleccionar tipos de nodo lógico"
      },
      "placeholder": "Cargue un archivo SCL que contenga elementos IED.",
      "uniquewarning": "La clase de nodo lógico ya existe",
      "reference": "Agregar referencia a un nodo lógico existente",
      "instance": "Agregar referencia a un tipo de nodo lógico"
    },
    "log": {
      "title": "No se puede agregar un LNode de la clase {{lnClass}}",
      "nonuniquelninst": "No se encontró un lnInst único",
      "uniqueln0": "Solo se permite una instancia de {{lnClass}}"
    },
    "tooltip": "Crear referencia a nodos lógicos"
  },
  "guess": {
    "wizard": {
      "primary": "Deducir contenido",
      "title": "Seleccionar modelo de control (ctlModel)",
      "description": "Los IEDs suelen contener más nodos lógicos controlables que aparatos de maniobra en el campo. \n Puede seleccionar los modelos de control usados específicamente para aparatos de maniobra."
    }
  },
  "merge": {
    "title": "Fusionar",
    "defaultTitle": "Fusionar {{ source }} en {{ sink }} ({{ tag }})",
    "log": "Se fusionó {{ tag }} {{ source }} en {{ sink }}",
    "children": "Elementos hijos"
  },
  "import": {
    "title": "Importar IEDs",
    "log": {
      "successful": "IED {{ name }} cargado",
      "parsererror": "Error de análisis (parser)",
      "loaderror": "No se pudo cargar el archivo",
      "importerror": "No se pudo importar el IED",
      "missingied": "No hay ningún elemento IED en el archivo",
      "nouniqueied": "El elemento IED {{ name }} ya existe en el archivo"
    }
  },
  "communication": {
    "name": "Configuración de red",
    "missing": "Sin subred"
  },
  "subnetwork": {
    "name": "Subred",
    "wizard": {
      "nameHelper": "Nombre de la subred",
      "descHelper": "Descripción de la subred",
      "typeHelper": "Tipo de red (p. ej. 8-MMS)",
      "bitrateHelper": "Velocidad (bit rate)",
      "title": {
        "add": "Agregar subred",
        "edit": "Editar subred"
      }
    }
  },
  "connectedap": {
    "name": "Punto de acceso conectado",
    "wizard": {
      "addschemainsttype": "Agregar tipo XMLSchema-instance"
    },
    "action": {
      "addaddress": "Editar dirección ({{iedName}} - {{apName}})"
    }
  },
  "gse": {
    "action": {
      "addaddress": "Editar GSE ({{identity}})"
    },
    "missingaccp": "El AccessPoint no está conectado. No se puede crear el GSE."
  },
  "smv": {
    "action": {
      "addaddress": "Editar SMV ({{identity}})"
    },
    "missingaccp": "El AccessPoint no está conectado. No se puede crear el SMV."
  },
  "subscriber": {
    "title": "Actualización de suscriptores",
    "description": "Actualización de suscriptores:",
    "nonewitems": "no hay nuevos elementos IEDName para agregar",
    "message": "Se agregaron {{updatenumber}} elementos IEDName al proyecto"
  },
  "commmap": {
    "title": "Mapeo de comunicación",
    "connectCB": "Conectar {{cbType}}",
    "connectToIED": "Conectar a {{iedName}}",
    "sourceIED": "IED origen",
    "sinkIED": "IED destino"
  },
  "updatesubstation": {
    "title": "Actualizar subestación"
  },
  "code": {
    "log": "Elemento modificado en el editor XML: {{id}}"
  },
  "updatedesc": {
    "abb": "Se agregaron descripciones de señales a los IEDs ABB",
    "sel": "Se agregaron descripciones de señales a los IEDs SEL"
  },
  "sld": {
    "substationSelector": "Seleccionar una subestación",
    "wizard": {
      "xCoordinateHelper": "Coordenada X para el diagrama unifilar",
      "yCoordinateHelper": "Coordenada Y para el diagrama unifilar"
    }
  },
  "dataset": {
    "fcda": {
      "add": "Agregar atributos de datos"
    },
    "fcd": {
      "add": "Agregar objetos de datos"
    }
  },
  "report": {
    "wizard": {
      "location": "Seleccionar ubicación del bloque de control de reportes"
    },
    "rptID": "Identificador del bloque de control de reportes"
  },
  "cleanup": {
    "unreferencedDataSets": {
      "title": "DataSets sin referencia",
      "deleteButton": "Eliminar DataSets seleccionados",
      "tooltip": "DataSets sin referencia desde un bloque de control GOOSE, de Log, de Reportes o de Valores Muestreados asociado"
    },
    "unreferencedControls": {
      "title": "Bloques de control con DataSet faltante o inválido",
      "deleteButton": "Eliminar bloques de control seleccionados",
      "tooltip": "Bloques de control sin referencia a un DataSet existente. Tenga en cuenta que esto es normal en un archivo ICD o en un ReportControl MMS con DataSet asignado dinámicamente",
      "addressDefinitionTooltip": "Existe una definición de dirección para este bloque de control en la sección Communication",
      "alsoRemoveFromCommunication": "Eliminar también la dirección SMV/GSE"
    },
    "unreferencedDataTypes": {
      "title": "Tipos de datos sin referencia",
      "deleteButton": "Eliminar tipos de datos seleccionados",
      "tooltip": "Tipos de datos que no están referenciados en un nodo lógico ni en otro tipo de dato usado",
      "alsoRemoveSubTypes": "Eliminar también los subtipos",
      "stackExceeded": "Se superó la profundidad máxima de pila. El máximo permitido es {{maxStackDepth}}. La limpieza de tipos de datos quedó incompleta y el archivo pudo haberse dañado."
    }
  },
  "controlblock": {
    "action": {
      "edit": "Se editó {{type}} \"{{name}}\" en el IED {{iedName}}",
      "add": "Se agregó {{type}} \"{{name}}\" al IED {{iedName}}",
      "remove": "Se eliminó {{type}} \"{{name}}\" y sus elementos referenciados del IED {{iedName}}"
    },
    "hints": {
      "source": "IED origen",
      "missingServer": "No es un servidor",
      "exist": "Ya existe {{type}} con el nombre {{name}}",
      "noMatchingData": "No hay datos coincidentes",
      "valid": "Se puede copiar"
    },
    "label": {
      "copy": "Copiar a otros IEDs"
    }
  },
  "gsecontrol": {
    "wizard": {
      "location": "Seleccionar ubicación del bloque de control GOOSE"
    }
  },
  "samvpledvaluecontrol": {
    "wizard": {
      "location": "Seleccionar ubicación del bloque de control de valores muestreados"
    }
  },
  "publisher": {
    "selectbutton": "Seleccionar otro {{type}}",
    "nodataset": "Sin DataSet referenciado",
    "smv": {
      "commsetting": "Configuración de comunicación (SMV)",
      "noconnectedap": "Sin conexión a la SubNetwork",
      "smvopts": "Campos opcionales"
    }
  },
  "exportCommunication": {
    "noCommunicationSection": "No se exporta: la sección Communication está vacía"
  },
  "add": "Agregar",
  "new": "Nuevo",
  "remove": "Eliminar",
  "edit": "Editar",
  "move": "Mover",
  "create": "Crear",
  "save": "Guardar",
  "saveAs": "Guardar como",
  "open": "Abrir",
  "reset": "Restablecer",
  "cancel": "Cancelar",
  "close": "Cerrar",
  "filter": "Filtrar",
  "filters": "Filtros",
  "undo": "Deshacer",
  "redo": "Rehacer",
  "duplicate": "Clonar",
  "connect": "Conectar",
  "disconnect": "Desconectar",
  "next": "Siguiente"
};
