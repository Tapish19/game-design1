FROM heroiclabs/nakama:3.22.0

COPY ./data/modules /nakama/data/modules
COPY ./local.yml /nakama/data/local.yml

ENTRYPOINT ["/bin/sh", "-ec"]

CMD ["/nakama/nakama --config /nakama/data/local.yml --database.address postgresql://tapish199_gmail_com:e3v8zv4MYnVcSq9d210F8Q@woolly-larva-14771.jxf.gcp-asia-south1.cockroachlabs.cloud:26257/nakama?sslmode=require"]
