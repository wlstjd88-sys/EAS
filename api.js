async function analyzeProduct(url) {

    try {

        const response = await fetch(CONFIG.API_BASE_URL + "/analyze", {

            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                url: url
            })

        });

        return await response.json();

    } catch (err) {

        console.error(err);

        return {
            success: false,
            message: "서버 연결 실패"
        };

    }

}
