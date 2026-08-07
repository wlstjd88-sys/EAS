function analyze() {

    const url = document.getElementById("url").value.trim();

    if (!url) {
        alert("코스트코 상품 URL을 입력하세요.");
        return;
    }

    const result = document.getElementById("result");

    result.innerHTML = `
    <div class="loading">
        <div class="spinner"></div>
        <h3>AI가 상품을 분석하고 있습니다...</h3>
        <p>코스트코 상품 확인</p>
        <p>쿠팡 최저가 검색</p>
        <p>예상 수익 계산</p>
    </div>
    `;

    setTimeout(() => {

        result.innerHTML = `
        <div class="result-card">

            <h2>AI 분석 결과</h2>

            <table>

                <tr>
                    <th>항목</th>
                    <th>결과</th>
                </tr>

                <tr>
                    <td>상품명</td>
                    <td>Costco Product</td>
                </tr>

                <tr>
                    <td>코스트코 가격</td>
                    <td>19,990원</td>
                </tr>

                <tr>
                    <td>쿠팡 최저가</td>
                    <td>34,900원</td>
                </tr>

                <tr>
                    <td>예상 순이익</td>
                    <td class="profit">7,200원</td>
                </tr>

                <tr>
                    <td>ROI</td>
                    <td class="profit">36%</td>
                </tr>

                <tr>
                    <td>AI 추천</td>
                    <td class="good">★★★★★ 강력 추천</td>
                </tr>

            </table>

        </div>
        `;

    }, 1800);

}
