FROM postgres:18-alpine
# Apply security fixes to inherited packages as well as newly installed tools.
RUN apk upgrade --no-cache \
    && apk add --no-cache restic ca-certificates util-linux
# The backup entrypoint uses PostgreSQL client tools, not the server's privilege-switching helper.
RUN rm -f /usr/local/bin/gosu
COPY backup.sh /usr/local/bin/backup
RUN chmod 755 /usr/local/bin/backup
ENTRYPOINT ["/usr/local/bin/backup"]
CMD ["loop"]
