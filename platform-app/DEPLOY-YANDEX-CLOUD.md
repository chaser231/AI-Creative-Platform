# Деплой AI Creative Platform на Yandex Cloud

## Архитектура

```
Пользователь → Serverless Container (Next.js standalone)
                  ↕ (внутренняя сеть YC, бесплатно)
              Managed PostgreSQL (уже есть)
              Object Storage / S3 (уже есть)
```

## Предварительные требования

1. [Yandex Cloud CLI (yc)](https://yandex.cloud/ru/docs/cli/quickstart)
2. Docker (для локальной сборки) или сборка через CI
3. Аккаунт Yandex Cloud с активным платёжным профилем

---

## Шаг 1. Установка и настройка YC CLI

```bash
# Установка
curl -sSL https://storage.yandexcloud.net/yandexcloud-yc/install.sh | bash

# Инициализация (следуй инструкциям)
yc init

# Проверка
yc config list
```

## Шаг 2. Создание Container Registry

```bash
# Создать реестр
yc container registry create --name acp-registry

# Запомнить ID реестра (понадобится далее)
export CR_ID=$(yc container registry get --name acp-registry --format json | grep '"id"' | head -1 | cut -d'"' -f4)
echo "Registry ID: $CR_ID"

# Авторизация Docker в реестре
yc container registry configure-docker
```

## Шаг 3. Сборка и push Docker-образа

```bash
cd platform-app

# Сборка образа
docker build -t cr.yandex/$CR_ID/acp-platform:latest .

# Push в Container Registry
docker push cr.yandex/$CR_ID/acp-platform:latest
```

## Шаг 4. Создание сервисного аккаунта

```bash
# Сервисный аккаунт для контейнера
yc iam service-account create --name acp-container-sa

export SA_ID=$(yc iam service-account get --name acp-container-sa --format json | grep '"id"' | head -1 | cut -d'"' -f4)

# Роли: доступ к Container Registry + invocation
yc resource-manager folder add-access-binding --service-account-id $SA_ID \
  --role container-registry.images.puller \
  --id $(yc config get folder-id)

yc resource-manager folder add-access-binding --service-account-id $SA_ID \
  --role serverless-containers.containerInvoker \
  --id $(yc config get folder-id)
```

## Шаг 5. Создание Serverless Container

```bash
yc serverless container create --name acp-platform
```

## Шаг 6. Деплой ревизии

```bash
export CONTAINER_ID=$(yc serverless container get --name acp-platform --format json | grep '"id"' | head -1 | cut -d'"' -f4)

yc serverless container revision deploy \
  --container-id $CONTAINER_ID \
  --image cr.yandex/$CR_ID/acp-platform:latest \
  --cores 1 \
  --memory 1GB \
  --concurrency 4 \
  --execution-timeout 300s \
  --service-account-id $SA_ID \
  --environment \
    DATABASE_URL="postgresql://acp_admin:PASSWORD@rc1a-8bmsd3jc3p2p5vj2.mdb.yandexcloud.net:6432/acp?sslmode=verify-full",\
    NEXTAUTH_URL="https://YOUR_DOMAIN",\
    NEXTAUTH_SECRET="YOUR_SECRET",\
    YANDEX_CLIENT_ID="YOUR_CLIENT_ID",\
    YANDEX_CLIENT_SECRET="YOUR_CLIENT_SECRET",\
    S3_ENDPOINT="https://storage.yandexcloud.net",\
    S3_ACCESS_KEY_ID="YOUR_S3_KEY",\
    S3_SECRET_ACCESS_KEY="YOUR_S3_SECRET",\
    S3_BUCKET="acp-assets",\
    FAL_KEY="YOUR_FAL_KEY",\
    REPLICATE_API_TOKEN="YOUR_TOKEN"
```

> **Важно:** Суммарный объём env-переменных ≤ 4 КБ.
> Если не хватает — используйте Yandex Lockbox для секретов.

## Шаг 7. Публичный доступ

```bash
# Сделать контейнер публично доступным
yc serverless container allow-unauthenticated-invoke --name acp-platform

# Получить URL
yc serverless container get --name acp-platform --format json | grep url
```

Контейнер получит URL вида `https://xxx.containers.yandexcloud.net`.

## Шаг 8. Привязка домена (опционально)

Для привязки своего домена используйте API Gateway или настройте
CNAME-запись + сертификат через Certificate Manager.

---

## Лимиты Serverless Containers

| Параметр | Значение |
|---|---|
| Макс. HTTP-запрос | 3.5 МБ (ОК после Phase 1 оптимизации) |
| Макс. время обработки | 10 мин (до 1 ч для long-lived) |
| Макс. RAM | 8 ГБ |
| Макс. размер образа | 10 ГБ |
| Экземпляры в зоне | 10 (квота, можно повысить) |

## Обновление

```bash
# Пересобрать и запушить
docker build -t cr.yandex/$CR_ID/acp-platform:latest .
docker push cr.yandex/$CR_ID/acp-platform:latest

# Деплой новой ревизии (та же команда из Шага 6)
yc serverless container revision deploy ...
```

## Альтернатива: Compute Instance

Если Serverless Containers не подходит (cold starts, лимиты),
можно использовать Compute Instance с Docker:

```bash
# Создать VM с Container Optimized Image
yc compute instance create-with-container \
  --name acp-platform-vm \
  --zone ru-central1-a \
  --cores 2 \
  --memory 4GB \
  --core-fraction 50 \
  --create-boot-disk size=30 \
  --docker-compose-file docker-compose.prod.yml \
  --public-ip
```

Стоимость: ~1000-1500 ₽/мес за VM с 50% CPU (core-fraction).
