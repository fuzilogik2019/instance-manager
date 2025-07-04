![Test](https://github.com/user-attachments/assets/c6dc6a99-0f6c-4ad1-81f2-dad994761ff1)
![Test2](https://github.com/user-attachments/assets/c30b61dd-1d80-4f68-9ccc-2280cdb4248c)
![Test3](https://github.com/user-attachments/assets/996f09e7-6031-4300-b8cc-096871237bd9)
![Test4](https://github.com/user-attachments/assets/4b256b5d-318f-4d41-a63e-667b27a61660)
![Test5](https://github.com/user-attachments/assets/bbd67d80-560e-4775-b6fd-cd299ca00a56)

# Instance Manager AWS EC2

Una aplicación web moderna para gestionar instancias EC2 de AWS con un frontend en React y backend en Node.js.

## 🚀 Inicio Rápido

### Requisitos Previos

- Node.js 18+ instalado
- Cuenta de AWS con acceso programático

### 1. Instalación de Dependencias

```bash
npm install
```

### 2. Configuración de Credenciales AWS

> **¡Nuevo flujo!**
> Ya no es necesario editar archivos `.env`. Al ingresar a la plataforma, se te pedirá tu **AWS Access Key**, **Secret Key** y la región. Estos datos se almacenan de forma segura en tu navegador (localStorage) y se envían al backend solo para la sesión activa.

1. Inicia la aplicación:

```bash
npm run dev
```

2. Accede a [http://localhost:5173](http://localhost:5173) y completa el formulario de credenciales AWS.
3. ¡Listo! Ya puedes gestionar tus recursos EC2.

## 🛠️ Funcionalidades Principales

- Lanzar instancias EC2 con configuración personalizada
- Iniciar, detener y terminar instancias
- Ver detalles y estado de instancias
- Soporte para instancias Spot
- Configuración de volúmenes EBS
- Selección y gestión de Security Groups
- Gestión de pares de claves SSH (crear, subir, eliminar)
- Multi-región
- Instalación automática de Docker y Docker Compose
- Opción de ejecutar imágenes Docker individuales o stacks completos con docker-compose
- Adjuntar y gestionar volúmenes adicionales

## 🔒 Seguridad y Manejo de Credenciales

- Las credenciales AWS **no se guardan en archivos** ni en el servidor.
- Se solicitan al usuario al iniciar sesión y se almacenan en localStorage.
- El backend solo mantiene las credenciales en variables de entorno durante la sesión activa.
- Puedes cambiar las credenciales desde la UI en cualquier momento.

## 🌍 Regiones Soportadas

La aplicación soporta todas las regiones públicas de AWS. Ejemplos populares:

- `us-east-1` - US East (N. Virginia)
- `us-west-2` - US West (Oregon)
- `eu-west-1` - Europa (Irlanda)
- `ap-southeast-1` - Asia Pacífico (Singapur)

## 📝 Permisos AWS Recomendados

Tu usuario IAM debe tener permisos mínimos para EC2:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ec2:RunInstances",
        "ec2:TerminateInstances",
        "ec2:StartInstances",
        "ec2:StopInstances",
        "ec2:DescribeInstances",
        "ec2:DescribeInstanceTypes",
        "ec2:DescribeRegions",
        "ec2:DescribeAvailabilityZones",
        "ec2:DescribeSecurityGroups",
        "ec2:DescribeKeyPairs",
        "ec2:DescribeVolumes",
        "ec2:CreateTags",
        "ec2:DescribeTags"
      ],
      "Resource": "*"
    }
  ]
}
```

Para funcionalidad completa, se recomienda `AmazonEC2FullAccess`.

## 💡 Consejos de Uso

- **Docker y docker-compose:** Puedes instalar Docker automáticamente y elegir entre ejecutar una imagen individual o subir tu propio archivo `docker-compose.yml` para stacks complejos.
- **Gestión de claves SSH:** Puedes crear, subir o eliminar pares de claves desde la UI. Las claves privadas solo se almacenan localmente.
- **Volúmenes EBS:** Crea y adjunta volúmenes adicionales a tus instancias fácilmente.

## 🐞 Solución de Problemas

- **"AWS credentials not configured"**: Asegúrate de haber ingresado correctamente tus credenciales en la UI.
- **Errores de permisos**: Verifica que tu usuario IAM tenga los permisos necesarios.
- **Problemas de lanzamiento de instancias**: Revisa los límites de tu cuenta y la disponibilidad de tipos de instancia en la región seleccionada.

## 💰 Consideraciones de Costos

- Las instancias EC2 y los volúmenes EBS generan cargos en tu cuenta AWS.
- El uso de instancias Spot puede reducir costos significativamente.
- Recuerda eliminar recursos que no utilices para evitar cargos innecesarios.

## 👨‍💻 Contribuir

1. Haz un fork del repositorio
2. Crea una rama para tu feature o fix
3. Realiza tus cambios y pruébalos
4. Envía un Pull Request

## 📄 Licencia

Este proyecto está licenciado bajo MIT.
