FROM postgres:18-alpine
RUN apk add --no-cache restic ca-certificates util-linux
# The backup entrypoint uses PostgreSQL client tools, not the server's privilege-switching helper.
RUN rm -f /usr/local/bin/gosu
COPY backup.sh /usr/local/bin/backup
RUN chmod 755 /usr/local/bin/backup
ENTRYPOINT ["/usr/local/bin/backup"]
CMD ["loop"]
