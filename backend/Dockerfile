FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    nmap \
    wget \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

ENV GO_VERSION=1.21.6
RUN wget https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz \
    && tar -C /usr/local -xzf go${GO_VERSION}.linux-amd64.tar.gz \
    && rm go${GO_VERSION}.linux-amd64.tar.gz
ENV PATH=$PATH:/usr/local/go/bin:/root/go/bin

RUN go install -v github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest

RUN nuclei -update-templates

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .