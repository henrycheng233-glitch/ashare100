"""Search abbreviations and common aliases for the fixed 2026-10-21 list.

The mapping is explicit so unusual names, spaces, and -U/-W suffixes are
reviewable.  It is validated against codes_top100.json by prepare_A_draft.py.
"""

PINYIN_BY_CODE = {
    "601398.SH": "GSYH", "688825.SH": "CXKJ", "601288.SH": "NYYH",
    "601939.SH": "JSYH", "601857.SH": "ZGSY", "601988.SH": "ZGYH",
    "600519.SH": "GZMT", "600941.SH": "ZGYD", "600036.SH": "ZSYH",
    "300750.SZ": "NDSD", "601088.SH": "ZGSH", "600938.SH": "ZGHY",
    "601138.SH": "GYFL", "601318.SH": "ZGPA", "601628.SH": "ZGRS",
    "300308.SZ": "ZJXC", "601899.SH": "ZJKY", "600900.SH": "CJDL",
    "601328.SH": "JTYH", "002594.SZ": "BYD", "601658.SH": "YCYH",
    "000333.SZ": "MDJT", "600028.SH": "ZGSH", "688256.SH": "HWJ",
    "601728.SH": "ZGDX", "688981.SH": "ZXGJ", "601998.SH": "ZXYH",
    "688235.SH": "BJSZ", "603259.SH": "YMKD", "688041.SH": "HGXX",
    "300502.SZ": "XYS", "002371.SZ": "BFHC", "601166.SH": "XYYH",
    "002475.SZ": "LXJM", "600030.SH": "ZXZQ", "600000.SH": "PFYH",
    "600276.SH": "HRYY", "601319.SH": "ZGRB", "002415.SZ": "HKWS",
    "603993.SH": "LYMY", "600183.SH": "SYKJ", "300059.SZ": "DFCF",
    "000858.SZ": "WLY", "601225.SH": "SXMY", "601211.SH": "GTHT",
    "688012.SH": "ZWGS", "600150.SH": "ZGCB", "601601.SH": "ZGTB",
    "601816.SH": "JHGT", "601919.SH": "ZYHK", "002714.SZ": "MYGF",
    "300394.SZ": "TFTX", "002142.SZ": "NBYH", "002384.SZ": "DSJM",
    "600919.SH": "JSYH", "000001.SZ": "PAYH", "002463.SZ": "HDGF",
    "688008.SH": "LQKJ", "003816.SZ": "ZGGH", "688836.SH": "YSKJ",
    "002916.SZ": "SNDL", "600309.SH": "WHHX", "000651.SZ": "GLDQ",
    "300760.SZ": "MRYL", "603986.SH": "ZYCX", "601985.SH": "ZGHD",
    "600025.SH": "HNSD", "603288.SH": "HTWY", "688801.SH": "SYKJ",
    "603268.SH": "SFGF", "300408.SZ": "SHJT", "000338.SZ": "WCDL",
    "601869.SH": "CFGX", "000725.SZ": "JDFA", "601668.SH": "ZGJZ",
    "688347.SH": "HHHL", "002379.SZ": "HQKG", "600406.SH": "GDNR",
    "688808.SH": "LXYQ", "688802.SH": "MXGF", "300476.SZ": "SHKJ",
    "688820.SH": "SHJW", "600887.SH": "YLGF", "302132.SZ": "ZHCF",
    "002938.SZ": "PDKG", "601766.SH": "ZGZC", "601818.SH": "GDYH",
    "601898.SH": "ZMNY", "688795.SH": "MECX", "600690.SH": "HEZJ",
    "600930.SH": "HDXN", "600989.SH": "BFNY", "600031.SH": "SYZG",
    "601066.SH": "ZXJT", "688072.SH": "TJKJ", "002352.SZ": "SFKG",
    "300274.SZ": "YGDY", "601688.SH": "HTZQ", "600188.SH": "YKNY",
    "300033.SZ": "THS",
}

# Widely used short names; the lower-case pinyin alias is added for every name.
EXTRA_ALIASES = {
    "601398.SH": ["工行"], "601288.SH": ["农行"],
    "601939.SH": ["建行"], "601988.SH": ["中行"],
    "600519.SH": ["茅台"], "600036.SH": ["招行"],
    "300750.SZ": ["宁王"], "601318.SH": ["平安"],
    "600028.SH": ["中石化"], "601857.SH": ["中石油"],
    "002594.SZ": ["比亚迪汽车"], "000858.SZ": ["五粮液"],
    "000725.SZ": ["京东方", "jdf"],
    "688836.SH": ["宇树科技"], "688801.SH": ["燧原科技"],
    "688802.SH": ["沐曦股份"], "688795.SH": ["摩尔线程"],
}

# Company website and 2025 annual report (cnoocltd.com): the F10 paragraph is
# shorter than the project's 200-character minimum.
PROFILE_OVERRIDES = {
    "600938.SH": (
        "中国海洋石油有限公司于1999年在香港注册成立，2001年在香港联交所上市，"
        "2022年在上海证券交易所上市，形成沪港两地上市架构。公司主要从事原油和天然气的"
        "勘探、开发、生产与销售，是中国重要的海上油气生产企业。公司以渤海、南海西部、"
        "南海东部和东海等中国海域为核心作业区域，并在亚洲、非洲、北美洲、南美洲、"
        "大洋洲和欧洲布局油气资产。其经营活动覆盖油气资源勘探、项目开发、生产运营"
        "及产品销售，国内外项目共同构成公司的油气业务组合。"
    ),
}

# Official registration addresses name Grand Cayman for these Cayman companies;
# this is an island/locality, not an independently disclosed municipality.
# BeOne's 2025 continuation changed its registered office to Basel, Switzerland.
REGISTERED_LOCALITY_OVERRIDES = {
    "688981.SH": "大开曼岛",
    "688235.SH": "巴塞尔",
    "688820.SH": "大开曼岛",
}
