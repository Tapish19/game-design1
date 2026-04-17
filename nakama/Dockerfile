FROM heroiclabs/nakama:3.22.0

COPY ./data/modules /nakama/data/modules
COPY ./local.yml /nakama/data/local.yml

ENTRYPOINT ["/nakama/nakama"]

CMD ["--config", "/nakama/data/local.yml", "--database.address", "postgresql://tapish199_gmail_com:YxNL-J-eoOBh_l9ax7KvvA@ochre-mollusk-14773.jxf.gcp-asia-south1.cockroachlabs.cloud:26257/nakama?sslmode=require"]
