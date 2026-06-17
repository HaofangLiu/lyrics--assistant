FROM python:3.12-slim-bookworm

# Railway builds from overseas, so official sources are the safest defaults.
# For domestic China/NAS builds, override these build args, for example:
#   DEBIAN_MIRROR=https://mirrors.tuna.tsinghua.edu.cn/debian
#   DEBIAN_SECURITY_MIRROR=https://mirrors.tuna.tsinghua.edu.cn/debian-security
#   PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
ARG DEBIAN_MIRROR=http://deb.debian.org/debian
ARG DEBIAN_SECURITY_MIRROR=http://deb.debian.org/debian-security
ARG PIP_INDEX_URL=https://pypi.org/simple

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PIP_INDEX_URL=$PIP_INDEX_URL
ENV PORT=8000

RUN sed -i \
  -e "s|http://deb.debian.org/debian-security|${DEBIAN_SECURITY_MIRROR}|g" \
  -e "s|http://deb.debian.org/debian|${DEBIAN_MIRROR}|g" \
  /etc/apt/sources.list.d/debian.sources

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY app /app/app

EXPOSE 8000

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
